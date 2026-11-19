#!/usr/bin/env python3
"""
Sovereign Google Sheets Live Date-Tab Auto-Ingest & DK Lineup Upload Exporter
Sheet ID: 1fUgQhRUnLZ7gDFqunZExxuGsO_rYAE6wDzuPjh0pJVA
Automatically finds tabs matching today's date (MM-DD-YYYY or M/D/YYYY),
deduplicates player IDs, runs !SCRUB + Sovereign v4.9 Cliff (1.55x),
and writes ready-to-upload DraftKings CSV lineups.
"""
import csv
import datetime
import json
import os
import subprocess
import sys
import urllib.parse
from zoneinfo import ZoneInfo
import pulp
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

SHEET_ID = "1fUgQhRUnLZ7gDFqunZExxuGsO_rYAE6wDzuPjh0pJVA"
SA_PATH = os.path.expanduser("~/.config/gasm/service_account_key.json")
FALLBACK_CSV = os.path.expanduser("~/ava-mcp-agent/live_slate_2026_11_19.csv")
SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"]

USAGE_VACUUMS = {
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

def get_sheets_headers():
    if os.path.exists(SA_PATH):
        creds = service_account.Credentials.from_service_account_file(
            SA_PATH, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
        )
        creds.refresh(Request())
        return {"Authorization": f"Bearer {creds.token}"}
    return None

def fetch_today_sheet_rows(target_dt):
    date_patterns = [
        target_dt.strftime("%m-%d-%Y"),
        target_dt.strftime("%-m-%-d-%Y"),
        target_dt.strftime("%m/%d/%Y"),
        target_dt.strftime("%Y-%m-%d"),
    ]
    headers = get_sheets_headers()
    if headers:
        meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
        resp = requests.get(meta_url, headers=headers, timeout=15)
        if resp.status_code == 200:
            sheets = resp.json().get("sheets", [])
            matched_titles = [
                s["properties"]["title"]
                for s in sheets
                if any(pat in s["properties"]["title"] for pat in date_patterns)
            ]
            if matched_titles:
                chosen_tab = matched_titles[0]
                print(f"✅ LIVE GOOGLE SHEETS API CONNECTED: Matched Today's Tab -> '{chosen_tab}'")
                enc_tab = urllib.parse.quote(chosen_tab)
                val_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{enc_tab}"
                v_resp = requests.get(val_url, headers=headers, timeout=15)
                if v_resp.status_code == 200:
                    return v_resp.json().get("values", []), chosen_tab
        elif resp.status_code == 403:
            print("⚠️  Share Sheet 1fUgQhRUnLZ7gDFqunZExxuGsO_rYAE6wDzuPjh0pJVA (Viewer) with ava-dfs@gasm-481006.iam.gserviceaccount.com for direct API pulls. Using synced 11-19-2026 tab cache...")

    if os.path.exists(FALLBACK_CSV):
        with open(FALLBACK_CSV, "r", encoding="utf-8-sig") as f:
            return list(csv.reader(f)), "NBA $200K Fadeaway -$50K to 1st- - 11-19-2026 08-00 PM (Cached)"
    raise RuntimeError("No live Google Sheet access or local fallback CSV available.")

def parse_deduplicated_rows(raw_rows):
    anchor_idx = None
    col_start = 0
    for idx, r in enumerate(raw_rows[:15]):
        cleaned = [c.strip() for c in r]
        if "Position" in cleaned and "Name + ID" in cleaned:
            anchor_idx = idx
            col_start = cleaned.index("Position")
            break
    if anchor_idx is None:
        raise ValueError("Header anchor 'Position' / 'Name + ID' not found in first 15 rows.")

    header_slice = [c.strip() for c in raw_rows[anchor_idx][col_start:col_start + 11]]
    seen_ids = set()
    records = []
    for r in raw_rows[anchor_idx + 1:]:
        chunk = [c.strip() for c in r[col_start:col_start + len(header_slice)]]
        if len(chunk) < 9 or not chunk[2] or chunk[0] == "Position":
            continue
        rec = dict(zip(header_slice, chunk + [""] * (len(header_slice) - len(chunk))))
        dk_id = rec.get("ID", "").strip()
        if not dk_id or dk_id in seen_ids:
            continue
        seen_ids.add(dk_id)
        records.append(rec)
    return records

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
    SELECT player_name, ROUND(AVG(fantasy_pts), 2) AS base_fpts
    FROM RankedGames WHERE rn <= 10 GROUP BY player_name
    """
    try:
        out = subprocess.check_output([
            "bq", "--project_id=gasm-481006", "--location=us-central1",
            "query", "--use_legacy_sql=false", "--format=json", "--max_rows=2000", sql
        ], stderr=subprocess.DEVNULL)
        return {r["player_name"].lower(): float(r["base_fpts"]) for r in json.loads(out.decode("utf-8")) if r.get("player_name") and r.get("base_fpts")}
    except Exception:
        return {}

def solve_and_export_dk_csv(pool, out_csv_path, num_lineups=5, salary_cap=50000):
    lineups = []
    excluded_sets = []
    n = len(pool)
    for l_idx in range(num_lineups):
        prob = pulp.LpProblem(f"Sovereign_Lineup_{l_idx+1}", pulp.LpMaximize)
        x = {
            (i, s): pulp.LpVariable(f"x_{i}_{s}", cat="Binary")
            for i, p in enumerate(pool) for s in SLOTS
            if eligible_for_slot(p["Roster_Position"], s)
        }
        prob += pulp.lpSum(pool[i]["Proj_Pts"] * x[(i, s)] for (i, s) in x)
        for s in SLOTS:
            prob += pulp.lpSum(x[(i, s)] for i in range(n) if (i, s) in x) == 1
        for i in range(n):
            prob += pulp.lpSum(x[(i, s)] for s in SLOTS if (i, s) in x) <= 1
        prob += pulp.lpSum(pool[i]["Salary"] * x[(i, s)] for (i, s) in x) <= salary_cap
        for prev in excluded_sets:
            prob += pulp.lpSum(x[(i, s)] for i in prev for s in SLOTS if (i, s) in x) <= len(SLOTS) - 2

        if pulp.LpStatus[prob.solve(pulp.PULP_CBC_CMD(msg=False))] != "Optimal":
            break
        slot_map = {}
        chosen = []
        for (i, s), var in x.items():
            if pulp.value(var) and pulp.value(var) > 0.5:
                slot_map[s] = pool[i]
                chosen.append(i)
        excluded_sets.append(chosen)
        lineups.append(slot_map)

    with open(out_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(SLOTS)
        for sm in lineups:
            writer.writerow([sm[s]["Name_ID"] for s in SLOTS])
    return lineups

def main():
    est_now = datetime.datetime.now(ZoneInfo("America/New_York"))
    date_iso = est_now.strftime("%Y-%m-%d")
    raw_rows, tab_name = fetch_today_sheet_rows(est_now)
    records = parse_deduplicated_rows(raw_rows)
    bq_fpts = fetch_bq_ava_10()

    active_pool = []
    purged_count = 0
    for row in records:
        status = (row.get("Status") or "").strip().upper()
        if status in {"OUT", "O", "INACTIVE", "SCRATCHED"}:
            purged_count += 1
            continue
        name = row["Name"].strip()
        sal = int(float(row["Salary"].replace("$", "").replace(",", "").strip() or 3000))
        avg_fpts = float(row["AvgPointsPerGame"].strip() or 0.0)
        bq_val = bq_fpts.get(name.lower())
        base = round((avg_fpts * 0.65) + (bq_val * 0.35), 2) if bq_val else avg_fpts
        bump = USAGE_VACUUMS.get(name.lower(), 1.0)
        bumped = round(base * bump, 2)
        cliff = bumped > 35.0
        final_proj = round(bumped * 1.55, 2) if cliff else bumped
        q_pen = -6 if status == "Q" else 0
        conf = max(60, min(98, int(76 + (10 if bump > 1.0 else 0) + (8 if cliff else 0) + q_pen)))
        active_pool.append({
            "Position": row["Position"],
            "Roster_Position": row["Roster Position"],
            "Name_ID": row["Name + ID"],
            "Name": name,
            "Team": row["TeamAbbrev"],
            "Salary": sal,
            "Proj_Pts": final_proj,
            "Confidence": conf
        })

    dk_upload_file = os.path.expanduser(f"~/ava-mcp-agent/docs/manual/dk_upload_{date_iso}.csv")
    lineups = solve_and_export_dk_csv(active_pool, dk_upload_file, num_lineups=5)
    print(f"✅ SOURCE TAB: {tab_name}")
    print(f"✅ DEDUPLICATED POOL: {len(active_pool)} Active | {purged_count} OUT Purged")
    print(f"✅ DRAFTKINGS UPLOAD CSV GENERATED: {dk_upload_file} ({len(lineups)} Optimal Lineups)")
    print("------------------------------------------------------------------")
    with open(dk_upload_file, "r", encoding="utf-8") as f:
        print(f.read().strip())

if __name__ == "__main__":
    main()
