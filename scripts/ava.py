#!/usr/bin/env python3
"""
ava.py - Master Hybrid CLI for GASM (gasm-481006 / us-central1)
Unifies:
  1. Sovereign Data Bible v5.0 SQL Aliases (ava_stats, ava_10, ava_slates, ava_fatigue, ava_by_day, ava_venue, raw SQL)
  2. Full 42-Site [B2: THE FEED] Scouting Registry (NBA & MLB)
  3. System Operating Directive v6.0 Macros (!AUDIT, !STATS, !CHALK, !PARLAY, !SWAP, !LINEUPS GPP)
"""
import csv
import datetime
import json
import os
import subprocess
import sys
from zoneinfo import ZoneInfo
import pulp

PROJECT_ID = "gasm-481006"
LOCATION = "us-central1"
SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"]
SLATE_CSV = os.path.expanduser("~/ava-mcp-agent/live_slate_2026_11_19.csv")
MANUAL_DIR = os.path.expanduser("~/ava-mcp-agent/docs/manual")

B2_FULL_REGISTRY = [
    "https://www.nba.com/players/todays-lineups",
    "https://www.rotowire.com/basketball/nba-lineups.php",
    "https://rotogrinders.com/lineups/nba",
    "https://rotogrinders.com/grids/nba-dfs-injury-report",
    "https://basketballmonster.com/nbalineups.aspx",
    "https://www.cbssports.com/nba/injuries/",
    "https://www.cbssports.com/nba/lineups/",
    "https://sports.yahoo.com/nba/injuries/",
    "https://sports.yahoo.com/nba/lineups/",
    "https://www.basketball-reference.com/friv/injuries.fcgi",
    "https://sportsdata.usatoday.com/basketball/nba/injuries",
    "https://sportsethos.com/live-injury-report/",
    "https://www.sportsinsights.com/nba/injuries/",
    "https://www.fantasylabs.com/nba/news/",
    "https://www.oddstrader.com/nba/injuries/",
    "https://bellmediainc-tsn-prod.web.arc-cdn.net/nba/injuries/",
    "https://www.foxsports.com/nba/injuries",
    "https://www.foxsports.com/nba/lineups",
    "https://hashtagbasketball.com/nba-injury",
    "https://hashtagbasketball.com/nba-starting-lineups",
    "https://data.vsin.com/nba/injury-report/",
    "https://isheplayingtonight.com/teams",
    "https://www.fanduel.com/research/nba/player-news/injuries/",
    "https://www.actionnetwork.com/nba/lineups",
    "https://www.fantasypros.com/nba/lineups/",
    "https://www.lineups.com/nba/lineups",
    "https://www.fantasyalarm.com/nba/lineups",
    "https://fantasydata.com/nba/starting-lineups",
    "https://www.numberfire.com/nba/daily-fantasy/lineups",
    "https://www.rotoballer.com/nba/lineups",
    "https://www.covers.com/sport/basketball/nba/lineups",
    "https://www.vegasinsider.com/nba/lineups/",
    "https://www.oddsshark.com/nba/lineups",
    "https://www.linestarapp.com/DailyDashboard/Sport/NBA/",
    "https://basketball.realgm.com/nba/depth-charts",
    "https://basketball.realgm.com/nba/news",
    "https://www.espn.com/nba/depth",
    "https://www.sportsline.com/nba/lineups/",
    "https://draftedge.com/nba/nba-starting-lineups/",
    "https://www.dailyfaceoff.com/nba-starting-lineups",
    "https://www.teamrankings.com/nba/player-stats/lineups/",
    "https://www.rotowire.com/baseball/daily-lineups.php",
]

SQL_ALIASES = {
    "ava_stats": f"SELECT * FROM `{PROJECT_ID}.nba_data.game_by_game_logs` ORDER BY game_date DESC LIMIT 25;",
    "ava_10": (
        f"WITH RankedGames AS (SELECT *, ROW_NUMBER() OVER(PARTITION BY player_name ORDER BY game_date DESC) as rn "
        f"FROM `{PROJECT_ID}.nba_data.game_by_game_logs`) "
        f"SELECT player_name, COUNT(*) AS games, ROUND(AVG(pts),2) AS avg_pts, ROUND(AVG(reb),2) AS avg_reb, "
        f"ROUND(AVG(ast),2) AS avg_ast, ROUND(AVG(fantasy_pts),2) AS avg_fpts, "
        f"CASE WHEN AVG(fantasy_pts) > 35.0 THEN ROUND(AVG(fantasy_pts)*1.55, 2) ELSE ROUND(AVG(fantasy_pts), 2) END AS sov_cliff_v49 "
        f"FROM RankedGames WHERE rn <= 10 GROUP BY player_name ORDER BY avg_fpts DESC LIMIT 15;"
    ),
    "ava_slates": f"SELECT * FROM `{PROJECT_ID}.nba_data.historical_slates` ORDER BY game_date DESC, salary DESC LIMIT 25;",
    "ava_fatigue": (
        f"SELECT player_name, game_date, is_home, opponent, min, fantasy_pts, "
        f"DATE_DIFF(game_date, LAG(game_date) OVER(PARTITION BY player_name ORDER BY game_date), DAY) AS rest_days "
        f"FROM `{PROJECT_ID}.nba_data.game_by_game_logs` ORDER BY game_date DESC LIMIT 25;"
    ),
    "ava_by_day": (
        f"SELECT player_name, FORMAT_DATE('%A', game_date) AS day_of_week, COUNT(*) AS games, "
        f"ROUND(AVG(fantasy_pts), 2) AS avg_fpts FROM `{PROJECT_ID}.nba_data.game_by_game_logs` "
        f"GROUP BY player_name, day_of_week ORDER BY avg_fpts DESC LIMIT 25;"
    ),
    "ava_venue": (
        f"SELECT player_name, is_home, COUNT(*) AS games, ROUND(AVG(fantasy_pts), 2) AS avg_fpts "
        f"FROM `{PROJECT_ID}.nba_data.game_by_game_logs` GROUP BY player_name, is_home ORDER BY avg_fpts DESC LIMIT 25;"
    ),
}

USAGE_VACUUMS = {
    "brandin podziemski": 1.30, "yaxel lendeborg": 1.22, "de'anthony melton": 1.25,
    "charles bassey": 1.25, "gui santos": 1.20, "lamelo ball": 1.25,
    "jaden mcdaniels": 1.25, "ayo dosunmu": 1.25, "terrence shannon jr.": 1.22,
    "bones hyland": 1.20, "damian lillard": 1.25, "donovan clingan": 1.25,
    "jrue holiday": 1.20, "tyler herro": 1.25, "jaime jaquez jr.": 1.20,
    "ryan rollins": 1.22, "kel'el ware": 1.25, "caris levert": 1.30,
    "stephon castle": 1.20, "de'aaron fox": 1.20,
}

def run_bq(sql_str):
    subprocess.run([
        "bq", f"--project_id={PROJECT_ID}", f"--location={LOCATION}",
        "query", "--use_legacy_sql=false", "--format=pretty", sql_str
    ], check=True)

def eligible_for_slot(roster_pos_str, slot):
    tokens = {t.strip() for t in roster_pos_str.replace("/", ",").split(",") if t.strip()}
    if slot == "UTIL":
        return True
    if slot == "G":
        return bool(tokens & {"PG", "SG", "G"})
    if slot == "F":
        return bool(tokens & {"SF", "PF", "F"})
    return slot in tokens

def build_gpp_lineups(csv_path, num_lineups=5, salary_cap=50000):
    seen_ids = set()
    pool = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            dk_id = row["ID"].strip()
            status = (row.get("Status") or "").strip().upper()
            if not dk_id or dk_id in seen_ids or status in {"OUT", "O", "INACTIVE", "SCRATCHED"}:
                continue
            seen_ids.add(dk_id)
            name = row["Name"].strip()
            sal = int(float(row["Salary"].replace("$", "").replace(",", "").strip() or 3000))
            avg_fpts = float(row["AvgPointsPerGame"].strip() or 0.0)
            bump = USAGE_VACUUMS.get(name.lower(), 1.0)
            bumped = round(avg_fpts * bump, 2)
            proj = round(bumped * 1.55, 2) if bumped > 35.0 else bumped
            est_own = min(48.0, max(2.5, round((avg_fpts / (sal / 1000.0)) * 5.2 + (8.0 if bump >= 1.25 else 0.0), 1)))
            lev = round(proj / est_own, 2)
            # GPP Tournament Objective Score: rewards Sovereign ceiling + low-ownership leverage pivots
            gpp_score = round(proj + (lev * 3.25) - (4.0 if status == "Q" else 0.0), 2)
            pool.append({
                "Position": row["Position"].strip(),
                "Roster_Position": row["Roster Position"].strip(),
                "Name_ID": row["Name + ID"].strip(),
                "Name": name,
                "Team": row["TeamAbbrev"].strip(),
                "Salary": sal,
                "Proj_Pts": proj,
                "Est_Own": est_own,
                "Leverage": lev,
                "GPP_Score": gpp_score,
            })

    lineups = []
    excluded_sets = []
    n = len(pool)
    for l_idx in range(num_lineups):
        prob = pulp.LpProblem(f"GPP_Fadeaway_{l_idx+1}", pulp.LpMaximize)
        x = {
            (i, s): pulp.LpVariable(f"x_{i}_{s}", cat="Binary")
            for i, p in enumerate(pool) for s in SLOTS
            if eligible_for_slot(p["Roster_Position"], s)
        }
        prob += pulp.lpSum(pool[i]["GPP_Score"] * x[(i, s)] for (i, s) in x)
        for s in SLOTS:
            prob += pulp.lpSum(x[(i, s)] for i in range(n) if (i, s) in x) == 1
        for i in range(n):
            prob += pulp.lpSum(x[(i, s)] for s in SLOTS if (i, s) in x) <= 1
        prob += pulp.lpSum(pool[i]["Salary"] * x[(i, s)] for (i, s) in x) <= salary_cap
        prob += pulp.lpSum(pool[i]["Salary"] * x[(i, s)] for (i, s) in x) >= 49000
        # Enforce at least 2 unique players per GPP lineup for multi-entry tournament spread
        for prev in excluded_sets:
            prob += pulp.lpSum(x[(i, s)] for i in prev for s in SLOTS if (i, s) in x) <= len(SLOTS) - 2

        if pulp.LpStatus[prob.solve(pulp.PULP_CBC_CMD(msg=False))] != "Optimal":
            break
        sm = {}
        chosen = []
        tot_sal = 0
        tot_proj = 0.0
        tot_own = 0.0
        for (i, s), var in x.items():
            if pulp.value(var) and pulp.value(var) > 0.5:
                sm[s] = pool[i]
                chosen.append(i)
                tot_sal += pool[i]["Salary"]
                tot_proj += pool[i]["Proj_Pts"]
                tot_own += pool[i]["Est_Own"]
        excluded_sets.append(chosen)
        lineups.append({
            "rank": l_idx + 1,
            "slots": sm,
            "salary": tot_sal,
            "proj": round(tot_proj, 2),
            "avg_own": round(tot_own / len(SLOTS), 1),
        })

    est_dt = datetime.datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    out_csv = os.path.join(MANUAL_DIR, f"dk_upload_gpp_{est_dt}.csv")
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(SLOTS)
        for lu in lineups:
            w.writerow([lu["slots"][s]["Name_ID"] for s in SLOTS])

    print(f"✅ REGISTERED {len(B2_FULL_REGISTRY)} DEDUPLICATED [B2] SCOUTING ENDPOINTS IN ava.py.")
    print(f"✅ GPP TOURNAMENT UPLOAD CSV READY: {out_csv}\n")
    print("### 🏆 !LINEUPS GPP MAX-LEVERAGE TOURNAMENT BUILDS ($200K FADEAWAY - $50K TO 1ST)")
    print("| # | PG | SG | SF | PF | C | G | F | UTIL | Salary | Sovereign Proj | Avg Own% |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for lu in lineups:
        cells = [lu["slots"][s]["Name_ID"] for s in SLOTS]
        print(f"| **{lu['rank']}** | " + " | ".join(cells) + f" | ${lu['salary']} | **{lu['proj']:.2f}** | {lu['avg_own']}% |")
    return out_csv

def main():
    if len(sys.argv) < 2 or sys.argv[1].lower() == "gpp":
        build_gpp_lineups(SLATE_CSV, num_lineups=5)
        return
    cmd = sys.argv[1]
    if cmd in SQL_ALIASES:
        run_bq(SQL_ALIASES[cmd])
    else:
        run_bq(" ".join(sys.argv[1:]))

if __name__ == "__main__":
    main()
