#!/usr/bin/env python3
"""
Sovereign Google Sheets Auto-Ingest & Live Slate Engine (v6.0 / v4.9 Cliff)
Sheet ID: 1fUgQhRUnLZ7gDFqunZExxuGsO_rYAE6wDzuPjh0pJVA
Automatically parses today's date tab, purges Status == 'OUT', archives to
gasm-481006.nba_data.historical_slates, and solves Top 5 PuLP NBA Classic Lineups.
"""
import csv
import json
import subprocess
import sys
import pulp

SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"]

# Usage Vacuum Multipliers derived from today's 11-19-2026 OUT stars:
# GSW (Curry, Butler, Draymond OUT), MIN (Ant Edwards, DiVincenzo OUT),
# POR (Ja Morant, Sharpe, R. Williams OUT), MIL (M. Turner, Kuzma OUT), SAS (D. Harper OUT)
USAGE_VACUUMS_11_19 = {
    "brandin podziemski": 1.30,
    "yaxel lendeborg": 1.22,
    "de'anthony melton": 1.25,
    "charles bassey": 1.25,
    "gui santos": 1.20,
    "lamelo ball": 1.25,
    "jaden mcdaniels": 1.25,
    "ayo dosunmu": 1.25,
    "terrence shannon jr.": 1.22,
    "bones hyland": 1.20,
    "damian lillard": 1.25,
    "donovan clingan": 1.25,
    "jrue holiday": 1.20,
    "tyler herro": 1.25,
    "jaime jaquez jr.": 1.20,
    "ryan rollins": 1.22,
    "kel'el ware": 1.25,
    "caris levert": 1.30,
    "stephon castle": 1.20,
    "de'aaron fox": 1.20,
}

def eligible_for_slot(roster_pos_str, slot):
    tokens = {t.strip() for t in roster_pos_str.replace("/", ",").split(",") if t.strip()}
    if slot == "UTIL":
        return True
    if slot == "G":
        return bool(tokens & {"PG", "SG", "G"})
    if slot == "F":
        return bool(tokens & {"SF", "PF", "F"})
    return slot in tokens

def fetch_bq_ava_10():
    sql = """
    WITH RankedGames AS (
      SELECT *, ROW_NUMBER() OVER(PARTITION BY player_name ORDER BY game_date DESC) as rn
      FROM `gasm-481006.nba_data.game_by_game_logs`
    )
    SELECT
      player_name,
      ROUND(AVG(fantasy_pts), 2) AS base_fpts
    FROM RankedGames
    WHERE rn <= 10
    GROUP BY player_name
    """
    try:
        out = subprocess.check_output([
            "bq", "--project_id=gasm-481006", "--location=us-central1",
            "query", "--use_legacy_sql=false", "--format=json", "--max_rows=2000", sql
        ])
        rows = json.loads(out.decode("utf-8"))
        return {r["player_name"].lower(): float(r["base_fpts"]) for r in rows if r.get("player_name") and r.get("base_fpts")}
    except Exception:
        return {}

def solve_pulp_lineups(pool, num_lineups=5, salary_cap=50000):
    lineups = []
    excluded_sets = []
    n = len(pool)
    for l_idx in range(num_lineups):
        prob = pulp.LpProblem(f"Sovereign_11_19_Lineup_{l_idx+1}", pulp.LpMaximize)
        x = {}
        for i, p in enumerate(pool):
            for s in SLOTS:
                if eligible_for_slot(p["Roster_Position"], s):
                    x[(i, s)] = pulp.LpVariable(f"x_{i}_{s}", cat="Binary")

        prob += pulp.lpSum(pool[i]["Proj_Pts"] * x[(i, s)] for (i, s) in x)
        for s in SLOTS:
            prob += pulp.lpSum(x[(i, s)] for i in range(n) if (i, s) in x) == 1
        for i in range(n):
            prob += pulp.lpSum(x[(i, s)] for s in SLOTS if (i, s) in x) <= 1
        prob += pulp.lpSum(pool[i]["Salary"] * x[(i, s)] for (i, s) in x) <= salary_cap

        for prev in excluded_sets:
            prob += pulp.lpSum(x[(i, s)] for i in prev for s in SLOTS if (i, s) in x) <= len(SLOTS) - 2

        status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
        if pulp.LpStatus[status] != "Optimal":
            break

        slot_map = {}
        chosen = []
        tot_sal = 0
        tot_pts = 0.0
        tot_conf = 0
        for (i, s), var in x.items():
            if pulp.value(var) and pulp.value(var) > 0.5:
                slot_map[s] = pool[i]
                chosen.append(i)
                tot_sal += pool[i]["Salary"]
                tot_pts += pool[i]["Proj_Pts"]
                tot_conf += pool[i]["Confidence"]
        excluded_sets.append(chosen)
        lineups.append({
            "rank": l_idx + 1,
            "slots": slot_map,
            "salary": tot_sal,
            "proj": round(tot_pts, 2),
            "conf": round(tot_conf / len(SLOTS), 1)
        })
    return lineups

def execute_live_sheet_pipeline(csv_path):
    bq_fpts = fetch_bq_ava_10()
    active_pool = []
    purged_out = []
    bq_archive_rows = []

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["Name"].strip()
            status = (row.get("Status") or "").strip().upper()
            sal = int(float(row["Salary"].replace("$", "").replace(",", "").strip()))
            avg_fpts = float(row["AvgPointsPerGame"].strip() or 0.0)

            bq_archive_rows.append({
                "game_date": "2026-11-19",
                "slate_id": 1,
                "position": row["Position"].strip(),
                "name_plus_id": row["Name + ID"].strip(),
                "player_name": name,
                "dk_id": row["ID"].strip(),
                "roster_position": row["Roster Position"].strip(),
                "salary": sal,
                "game_info": row["Game Info"].strip(),
                "team_abbrev": row["TeamAbbrev"].strip(),
                "avg_points_per_game": avg_fpts
            })

            if status in {"OUT", "O", "INACTIVE", "SCRATCHED"}:
                purged_out.append(f"{name} ({row['TeamAbbrev'].strip()} - ${sal})")
                continue

            # Blend sheet AvgPointsPerGame with BigQuery rolling 10-game trend
            bq_val = bq_fpts.get(name.lower())
            base = round((avg_fpts * 0.65) + (bq_val * 0.35), 2) if bq_val else avg_fpts
            bump = USAGE_VACUUMS_11_19.get(name.lower(), 1.0)
            bumped_base = round(base * bump, 2)

            # Sovereign Cliff v4.9 (1.55x if > 35.0)
            cliff = bumped_base > 35.0
            final_proj = round(bumped_base * 1.55, 2) if cliff else bumped_base
            val = round((final_proj / sal) * 1000.0, 2) if sal > 0 else 0.0

            q_penalty = -6 if status == "Q" else 0
            conf = max(60, min(98, int(76 + (10 if bump > 1.0 else 0) + (8 if cliff else 0) + q_penalty)))

            logic_tags = []
            if bump > 1.0:
                logic_tags.append(f"Vacuum ({bump}x)")
            if cliff:
                logic_tags.append("SOV_CLIFF_1.55")
            if sal <= 4500 and final_proj >= 18.0:
                logic_tags.append("VALUE_GAP_STARTER")
            if status == "Q":
                logic_tags.append("Q-Tag Monitor")
            if not logic_tags:
                logic_tags.append("Rotation Core")

            active_pool.append({
                "Position": row["Position"].strip(),
                "Roster_Position": row["Roster Position"].strip(),
                "Name_ID": row["Name + ID"].strip(),
                "Name": name,
                "Team": row["TeamAbbrev"].strip(),
                "Salary": sal,
                "Status": status or "ACTIVE",
                "Base_FPTS": bumped_base,
                "Proj_Pts": final_proj,
                "Value": val,
                "Confidence": conf,
                "Logic": " + ".join(logic_tags)
            })

    # Archive today's slate into gasm-481006.nba_data.historical_slates
    tmp_jsonl = "/tmp/slate_2026_11_19.jsonl"
    with open(tmp_jsonl, "w") as jf:
        for r in bq_archive_rows:
            jf.write(json.dumps(r) + "\n")
    subprocess.run([
        "bq", "--project_id=gasm-481006", "--location=us-central1", "load",
        "--replace", "--source_format=NEWLINE_DELIMITED_JSON",
        "gasm-481006:nba_data.historical_slates", tmp_jsonl,
        "game_date:DATE,slate_id:INT64,position:STRING,name_plus_id:STRING,player_name:STRING,dk_id:STRING,roster_position:STRING,salary:INT64,game_info:STRING,team_abbrev:STRING,avg_points_per_game:FLOAT64"
    ], check=True, stdout=subprocess.DEVNULL)

    print(f"✅ !SCRUB COMPLETE (11-19-2026 8:00 PM Main Slate): {len(active_pool)} active players retained | {len(purged_out)} OUT players purged.")
    print(f"✅ ARCHIVED {len(bq_archive_rows)} rows into gasm-481006.nba_data.historical_slates (us-central1).")

    active_pool.sort(key=lambda x: (x["Proj_Pts"], x["Value"]), reverse=True)
    print("\n### 📊 !STATS TOP 25 MASTER PROJECTION TABLE (11-19-2026 NBA $200K FADEAWAY)")
    print("| Pos | Name + ID | Team | Salary | Status | Bumped Base | Sovereign Proj | Value (Pts/$1K) | Conf | Logic |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for r in active_pool[:25]:
        n_fmt = f"**{r['Name_ID']}**" if r["Confidence"] >= 85 else f"*{r['Name_ID']}*"
        print(f"| {r['Position']} | {n_fmt} | {r['Team']} | ${r['Salary']} | {r['Status']} | {r['Base_FPTS']:.2f} | **{r['Proj_Pts']:.2f}** | {r['Value']:.2f}x | {r['Confidence']}/100 | {r['Logic']} |")

    parlays = [r for r in active_pool if r["Confidence"] >= 85 and r["Status"] == "ACTIVE"]
    parlays.sort(key=lambda x: (x["Confidence"], x["Value"]), reverse=True)
    print("\n### 🎯 !PARLAY TOP 10 POWER TABLE (CONFIDENCE >= 85 & CONFIRMED ACTIVE)")
    print("| Name + ID | Pos | Team | Salary | Sovereign Proj | Value (Pts/$1K) | Confidence | Parlay Logic |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for r in parlays[:10]:
        print(f"| **{r['Name_ID']}** | {r['Position']} | {r['Team']} | ${r['Salary']} | **{r['Proj_Pts']:.2f}** | {r['Value']:.2f}x | {r['Confidence']}/100 | {r['Logic']} |")

    lineups = solve_pulp_lineups(active_pool, num_lineups=5)
    print(f"\n### 🏆 !LINEUPS TOP {len(lineups)} PULP MILP OPTIMAL LINEUPS (11-19-2026 NBA CLASSIC)")
    print("| # | PG | SG | SF | PF | C | G | F | UTIL | Salary | Total Proj | Confidence |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for lu in lineups:
        sm = lu["slots"]
        cells = [sm[s]["Name_ID"] for s in SLOTS]
        print(f"| **{lu['rank']}** | " + " | ".join(cells) + f" | ${lu['salary']} | **{lu['proj']:.2f}** | {lu['conf']}/100 |")
    print("\n[Sources: B1_GoogleSheet_11-19-2026_Tab, B2_Sheet_Status_Column, B3_gasm-481006.nba_data.game_by_game_logs]")

if __name__ == "__main__":
    execute_live_sheet_pipeline(sys.argv[1])
