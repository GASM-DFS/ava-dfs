#!/usr/bin/env python3
"""
Sovereign Dual-Provider (DraftKings & FanDuel) Google Sheets Ingest & CSV Exporter
Auto-detects provider from tab title / headers or accepts: --provider dk | fd | both
Automatically downloads the resulting provider-formatted CSV via cloudshell download.
"""
import argparse
import csv
import datetime
import json
import os
import subprocess
import urllib.parse
from zoneinfo import ZoneInfo
import pulp
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

SHEET_ID = "1fUgQhRUnLZ7gDFqunZExxuGsO_rYAE6wDzuPjh0pJVA"
SA_PATH = os.path.expanduser("~/.config/gasm/service_account_key.json")
FALLBACK_CSV = os.path.expanduser("~/ava-mcp-agent/live_slate_2026_11_19.csv")
OUT_DIR = os.path.expanduser("~/ava-mcp-agent/docs/manual")

DK_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"]
FD_SLOTS = ["PG", "PG", "SG", "SG", "SF", "SF", "PF", "PF", "C"]

USAGE_VACUUMS = {
    "brandin podziemski": 1.30, "yaxel lendeborg": 1.22, "de'anthony melton": 1.25,
    "charles bassey": 1.25, "gui santos": 1.20, "lamelo ball": 1.25,
    "jaden mcdaniels": 1.25, "ayo dosunmu": 1.25, "terrence shannon jr.": 1.22,
    "bones hyland": 1.20, "damian lillard": 1.25, "donovan clingan": 1.25,
    "jrue holiday": 1.20, "tyler herro": 1.25, "jaime jaquez jr.": 1.20,
    "ryan rollins": 1.22, "kel'el ware": 1.25, "caris levert": 1.30,
    "stephon castle": 1.20, "de'aaron fox": 1.20,
}

def get_sheets_headers():
    if os.path.exists(SA_PATH):
        creds = service_account.Credentials.from_service_account_file(
            SA_PATH, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
        )
        creds.refresh(Request())
        return {"Authorization": f"Bearer {creds.token}"}
    return None

def fetch_date_tabs(target_dt):
    patterns = [
        target_dt.strftime("%m-%d-%Y"),
        target_dt.strftime("%-m-%-d-%Y"),
        target_dt.strftime("%m/%d/%Y"),
        target_dt.strftime("%Y-%m-%d"),
    ]
    headers = get_sheets_headers()
    tabs_data = []
    if headers:
        r = requests.get(f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}", headers=headers, timeout=15)
        if r.status_code == 200:
            for s in r.json().get("sheets", []):
                title = s["properties"]["title"]
                if any(p in title for p in patterns) and "NFL" not in title.upper():
                    enc = urllib.parse.quote(title)
                    vr = requests.get(
                        f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{enc}",
                        headers=headers, timeout=15
                    )
                    if vr.status_code == 200:
                        tabs_data.append((title, vr.json().get("values", [])))
    if not tabs_data and os.path.exists(FALLBACK_CSV):
        with open(FALLBACK_CSV, "r", encoding="utf-8-sig") as f:
            tabs_data.append(("Cached_11-19-2026_Slate", list(csv.reader(f))))
    return tabs_data

def detect_and_parse(title, raw_rows):
    anchor_idx, col_start, detected_provider = None, 0, "DK"
    if any(k in title.upper() for k in ["FANDUEL", "FD "]):
        detected_provider = "FD"
    for idx, row in enumerate(raw_rows[:15]):
        cleaned = [c.strip() for c in row]
        if "Nickname" in cleaned and "FPPG" in cleaned:
            anchor_idx, col_start, detected_provider = idx, cleaned.index("Id") if "Id" in cleaned else 0, "FD"
            break
        if "Position" in cleaned and ("Name + ID" in cleaned or "Name" in cleaned):
            anchor_idx, col_start = idx, cleaned.index("Position")
            break
    if anchor_idx is None:
        raise ValueError(f"No valid DK or FD header row found in tab '{title}'.")

    headers = [c.strip() for c in raw_rows[anchor_idx][col_start:col_start + 14]]
    seen_ids = set()
    pool = []
    for r in raw_rows[anchor_idx + 1:]:
        chunk = [c.strip() for c in r[col_start:col_start + len(headers)]]
        if len(chunk) < 6:
            continue
        rec = dict(zip(headers, chunk + [""] * (len(headers) - len(chunk))))
        if detected_provider == "FD" and "Nickname" in rec:
            pid = rec.get("Id", "").strip()
            name = rec.get("Nickname", "").strip()
            pos = rec.get("Position", "").strip()
            sal_raw = rec.get("Salary", "3500")
            fpts_raw = rec.get("FPPG", "0")
            team = rec.get("Team", "").strip()
            status = (rec.get("Injury Indicator") or rec.get("Status") or "").strip().upper()
        else:
            pid = rec.get("ID", "").strip()
            name = rec.get("Name", "").strip()
            pos = rec.get("Position", "").strip()
            sal_raw = rec.get("Salary", "3000")
            fpts_raw = rec.get("AvgPointsPerGame", "0")
            team = rec.get("TeamAbbrev", "").strip()
            status = (rec.get("Status") or "").strip().upper()

        if not pid or not name or pid in seen_ids or pos == "Position":
            continue
        seen_ids.add(pid)
        if status in {"OUT", "O", "INACTIVE", "SCRATCHED"}:
            continue

        sal = int(float(sal_raw.replace("$", "").replace(",", "").strip() or 3000))
        avg_fpts = float(fpts_raw.replace(",", "").strip() or 0.0)
        bump = USAGE_VACUUMS.get(name.lower(), 1.0)
        bumped = round(avg_fpts * bump, 2)
        proj = round(bumped * 1.55, 2) if bumped > 35.0 else bumped

        dk_sal = sal if detected_provider == "DK" else max(3000, int(round((sal / 1.14) / 100.0) * 100))
        fd_sal = sal if detected_provider == "FD" else max(3500, int(round((sal * 1.14) / 100.0) * 100))

        pool.append({
            "pos": pos,
            "name": name,
            "id": pid,
            "dk_cell": rec.get("Name + ID", f"{name} ({pid})").strip() or f"{name} ({pid})",
            "fd_cell": f"{pid}:{name}",
            "dk_salary": dk_sal,
            "fd_salary": fd_sal,
            "team": team,
            "proj": proj,
        })
    return detected_provider, pool

def eligible(pos_str, slot):
    tokens = {t.strip() for t in pos_str.replace("/", ",").split(",") if t.strip()}
    if slot == "UTIL":
        return True
    if slot == "G":
        return bool(tokens & {"PG", "SG"})
    if slot == "F":
        return bool(tokens & {"SF", "PF"})
    return slot in tokens

def solve_and_write_csv(pool, provider, num_lineups, date_iso):
    slots = DK_SLOTS if provider == "DK" else FD_SLOTS
    cap = 50000 if provider == "DK" else 60000
    sal_key = "dk_salary" if provider == "DK" else "fd_salary"
    cell_key = "dk_cell" if provider == "DK" else "fd_cell"
    max_team = 7 if provider == "DK" else 4

    n_p, n_s = len(pool), len(slots)
    excluded = []
    built = []

    for l_idx in range(num_lineups):
        prob = pulp.LpProblem(f"{provider}_Lineup_{l_idx+1}", pulp.LpMaximize)
        x = {
            (i, s_i): pulp.LpVariable(f"x_{i}_{s_i}", cat="Binary")
            for i, p in enumerate(pool) for s_i, s in enumerate(slots)
            if eligible(p["pos"], s)
        }
        prob += pulp.lpSum(pool[i]["proj"] * x[(i, s_i)] for (i, s_i) in x)
        for s_i in range(n_s):
            prob += pulp.lpSum(x[(i, s_i)] for i in range(n_p) if (i, s_i) in x) == 1
        for i in range(n_p):
            prob += pulp.lpSum(x[(i, s_i)] for s_i in range(n_s) if (i, s_i) in x) <= 1
        prob += pulp.lpSum(pool[i][sal_key] * x[(i, s_i)] for (i, s_i) in x) <= cap

        for t in {p["team"] for p in pool}:
            prob += pulp.lpSum(
                x[(i, s_i)] for i, p in enumerate(pool) if p["team"] == t
                for s_i in range(n_s) if (i, s_i) in x
            ) <= max_team

        for prev in excluded:
            prob += pulp.lpSum(x[(i, s_i)] for i in prev for s_i in range(n_s) if (i, s_i) in x) <= n_s - 2

        if pulp.LpStatus[prob.solve(pulp.PULP_CBC_CMD(msg=False))] != "Optimal":
            break
        row_cells = [""] * n_s
        chosen = []
        tot_sal, tot_proj = 0, 0.0
        for (i, s_i), var in x.items():
            if pulp.value(var) and pulp.value(var) > 0.5:
                row_cells[s_i] = pool[i][cell_key]
                chosen.append(i)
                tot_sal += pool[i][sal_key]
                tot_proj += pool[i]["proj"]
        excluded.append(chosen)
        built.append((row_cells, tot_sal, round(tot_proj, 2)))

    out_path = os.path.join(OUT_DIR, f"{provider.lower()}_nba_lineups_{date_iso}.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(slots)
        for cells, _, _ in built:
            w.writerow(cells)
    print(f"✅ [{provider}] EXPORTED {len(built)} OPTIMAL LINEUPS -> {out_path} (Cap: ${cap})")
    for idx, (_, s_used, p_tot) in enumerate(built, 1):
        print(f"   #{idx}: Salary=${s_used} | Sovereign Proj={p_tot}")
    return out_path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["auto", "dk", "fd", "both"], default="both")
    parser.add_argument("--lineups", type=int, default=5)
    args = parser.parse_args()

    est_now = datetime.datetime.now(ZoneInfo("America/New_York"))
    date_iso = est_now.strftime("%Y-%m-%d")
    tabs = fetch_date_tabs(est_now)

    generated_files = []
    for title, rows in tabs:
        detected, pool = detect_and_parse(title, rows)
        print(f"🛰️  SOURCE TAB: '{title}' | Detected Format: {detected} | Active Scrubbed Pool: {len(pool)}")
        targets = [detected] if args.provider == "auto" else (["DK", "FD"] if args.provider == "both" else [args.provider.upper()])
        for prov in targets:
            generated_files.append(solve_and_write_csv(pool, prov, args.lineups, date_iso))

    if os.system("command -v cloudshell >/dev/null 2>&1") == 0 and generated_files:
        subprocess.run(["cloudshell", "download"] + generated_files, check=False)

if __name__ == "__main__":
    main()
