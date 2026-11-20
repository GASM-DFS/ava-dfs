#!/usr/bin/env python3
"""
Sovereign Dual-Provider (DK & FanDuel) Ingest + 4-Layer Scouting Trap Filter
Guardrails:
  1. BigQuery Sample & Minutes Floor Gate (Purges non-starters with GP < 3 or Avg_Min < 18.0)
  2. Empirical Bayes Small-Sample Shrinkage (k=5 games prior)
  3. Starter/22+ MPG Gated Usage Vacuums (Blocks deep bench from inheriting star injury bumps)
  4. Live [B2] NLP Red-Flag Scanner + Google Sheet 'FADE'/'TRAP' Status & --fade CLI flag
"""
import argparse
import csv
import datetime
import json
import os
import re
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

RED_FLAG_REGEX = re.compile(
    r"(limited action|role remains uncertain|minutes restriction|minutes limit|out of the rotation|garbage time|mop-up)",
    re.IGNORECASE,
)

USAGE_VACUUMS = {
    "brandin podziemski": 1.30, "yaxel lendeborg": 1.22, "de'anthony melton": 1.25,
    "charles bassey": 1.25, "gui santos": 1.20, "lamelo ball": 1.25,
    "jaden mcdaniels": 1.25, "ayo dosunmu": 1.25, "terrence shannon jr.": 1.22,
    "damian lillard": 1.25, "donovan clingan": 1.25, "jrue holiday": 1.20,
    "sidy cissoko": 1.22, "tyler herro": 1.25, "jaime jaquez jr.": 1.20,
    "brayden burries": 1.22, "ryan rollins": 1.20, "kel'el ware": 1.25,
    "stephon castle": 1.20, "de'aaron fox": 1.20,
}

def fetch_bq_rotation_telemetry():
    """Pulls GP, Avg Minutes, L3 Minutes, and L10 FPTS from gasm-481006.nba_data.game_by_game_logs."""
    sql = """
    WITH Ranked AS (
      SELECT
        player_name,
        min,
        fantasy_pts,
        ROW_NUMBER() OVER(PARTITION BY player_name ORDER BY game_date DESC) AS rn
      FROM `gasm-481006.nba_data.game_by_game_logs`
    )
    SELECT
      player_name,
      COUNT(*) AS season_gp,
      ROUND(AVG(CASE WHEN rn <= 10 THEN min END), 2) AS avg_min_l10,
      ROUND(AVG(CASE WHEN rn <= 3 THEN min END), 2) AS avg_min_l3,
      ROUND(AVG(CASE WHEN rn <= 10 THEN fantasy_pts END), 2) AS avg_fpts_l10
    FROM Ranked
    GROUP BY player_name
    """
    try:
        out = subprocess.check_output([
            "bq", "--project_id=gasm-481006", "--location=us-central1",
            "query", "--use_legacy_sql=false", "--format=json", "--max_rows=3000", sql
        ], stderr=subprocess.DEVNULL)
        rows = json.loads(out.decode("utf-8"))
        return {r["player_name"].lower(): r for r in rows if r.get("player_name")}
    except Exception:
        return {}

def scan_b2_scouting_traps(candidate_names):
    """Scrapes live RotoWire/CBS headlines for low-minute / uncertain-role trap phrases."""
    flagged = set()
    urls = [
        "https://www.rotowire.com/basketball/news.php",
        "https://www.cbssports.com/nba/injuries/",
    ]
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Ava-GASM/6.1"}
    corpus = ""
    for u in urls:
        try:
            resp = requests.get(u, headers=headers, timeout=5)
            if resp.status_code < 400:
                corpus += " " + re.sub(r"<[^>]+>", " ", resp.text)
        except Exception:
            continue
    if corpus:
        for name in candidate_names:
            for m in re.finditer(re.escape(name), corpus, re.IGNORECASE):
                window = corpus[max(0, m.start() - 60):min(len(corpus), m.end() + 220)]
                if RED_FLAG_REGEX.search(window):
                    flagged.add(name.lower())
                    break
    return flagged

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

def detect_and_scrub_with_guardrails(title, raw_rows, bq_stats, manual_fades, min_mpg=18.0, min_gp=3):
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
    prelim = []
    seen_ids = set()

    for r in raw_rows[anchor_idx + 1:]:
        chunk = [c.strip() for c in r[col_start:col_start + len(headers)]]
        if len(chunk) < 6:
            continue
        rec = dict(zip(headers, chunk + [""] * (len(headers) - len(chunk))))
        if detected_provider == "FD" and "Nickname" in rec:
            pid, name, pos = rec.get("Id", ""), rec.get("Nickname", ""), rec.get("Position", "")
            sal_raw, fpts_raw, team = rec.get("Salary", "3500"), rec.get("FPPG", "0"), rec.get("Team", "")
            status = (rec.get("Injury Indicator") or rec.get("Status") or "").upper()
            starting_col = (rec.get("Starting") or rec.get("Starter") or "").upper()
        else:
            pid, name, pos = rec.get("ID", ""), rec.get("Name", ""), rec.get("Position", "")
            sal_raw, fpts_raw, team = rec.get("Salary", "3000"), rec.get("AvgPointsPerGame", "0"), rec.get("TeamAbbrev", "")
            status = (rec.get("Status") or "").upper()
            starting_col = (rec.get("Starting") or "").upper()

        if not pid or not name or pid in seen_ids or pos == "Position":
            continue
        seen_ids.add(pid)
        prelim.append((rec, pid, name, pos, sal_raw, fpts_raw, team, status, starting_col))

    b2_traps = scan_b2_scouting_traps([x[2] for x in prelim])
    pool = []
    trap_log = []

    for rec, pid, name, pos, sal_raw, fpts_raw, team, status, starting_col in prelim:
        lname = name.lower()
        # 1. Hard Status / Manual Fade / Sheet 'FADE' Tag Purge
        if status in {"OUT", "O", "INACTIVE", "SCRATCHED", "FADE", "TRAP", "BENCH", "X"} or lname in manual_fades:
            if status in {"FADE", "TRAP", "BENCH", "X"} or lname in manual_fades:
                trap_log.append(f"{name} (Manual/Sheet FADE)")
            continue

        sal = int(float(sal_raw.replace("$", "").replace(",", "").strip() or 3000))
        avg_fpts = float(fpts_raw.replace(",", "").strip() or 0.0)
        is_confirmed_starter = starting_col in {"Y", "YES", "1", "TRUE", "STARTER", "S"}

        bq = bq_stats.get(lname, {})
        gp = int(bq.get("season_gp") or (8 if sal >= 4200 else 2))
        est_mpg = float(bq.get("avg_min_l10") or (sal / 235.0 if sal >= 3800 else 12.0))

        # 2. Live [B2] NLP Trap Blurb Purge (catches 1-game / 8-minute mop-up traps like Caris LeVert)
        if lname in b2_traps and not is_confirmed_starter:
            trap_log.append(f"{name} ([B2] Scouting Red-Flag: Limited/Uncertain Role)")
            continue

        # 3. Minimum Sample & Rotation Floor Gate (Non-starters must meet GP >= 3 and MPG >= 18.0)
        if not is_confirmed_starter and (gp < min_gp or est_mpg < min_mpg):
            trap_log.append(f"{name} (${sal} | GP={gp}, Est_MPG={est_mpg:.1f} < {min_mpg}m Floor)")
            continue

        # 4. Empirical Bayes Shrinkage (k=5 prior games) + Rotation-Gated Vacuum
        bq_fpts = float(bq.get("avg_fpts_l10") or avg_fpts)
        blended_raw = (avg_fpts * 0.60) + (bq_fpts * 0.40)
        shrunk_base = ((gp * blended_raw) + (5.0 * (est_mpg * 0.85))) / (gp + 5.0)

        # Only confirmed starters or >= 22 MPG rotation players can inherit Usage Vacuum boosts
        bump = USAGE_VACUUMS.get(lname, 1.0) if (is_confirmed_starter or est_mpg >= 22.0) else 1.0
        bumped = round(shrunk_base * bump, 2)
        proj = round(bumped * 1.55, 2) if bumped > 35.0 else bumped
        if status == "Q":
            proj = round(proj * 0.94, 2)

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

    print(f"🛡️  SCOUTING GUARDRAIL PURGED {len(trap_log)} LOW-MINUTE / SMALL-SAMPLE TRAPS:")
    for t in trap_log[:12]:
        print(f"   ❌ Blocked: {t}")
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
    excluded, built = [], []

    for l_idx in range(num_lineups):
        prob = pulp.LpProblem(f"{provider}_Guarded_{l_idx+1}", pulp.LpMaximize)
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

    out_path = os.path.join(OUT_DIR, f"{provider.lower()}_nba_scouting_guarded_{date_iso}.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(slots)
        for cells, _, _ in built:
            w.writerow(cells)
    print(f"✅ [{provider}] EXPORTED {len(built)} SCOUTING-GUARDED LINEUPS -> {out_path}")
    for idx, (cells, s_used, p_tot) in enumerate(built, 1):
        print(f"   #{idx}: Salary=${s_used} | Guarded Proj={p_tot} | {', '.join(cells)}")
    return out_path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["auto", "dk", "fd", "both"], default="both")
    parser.add_argument("--lineups", type=int, default=5)
    parser.add_argument("--min-mpg", type=float, default=18.0)
    parser.add_argument("--min-gp", type=int, default=3)
    parser.add_argument("--fade", nargs="*", default=[], help="Manual player names to fade")
    args = parser.parse_args()

    manual_fades = {f.strip().lower() for f in args.fade} | {"caris levert"}
    est_now = datetime.datetime.now(ZoneInfo("America/New_York"))
    date_iso = est_now.strftime("%Y-%m-%d")

    bq_stats = fetch_bq_rotation_telemetry()
    tabs = fetch_date_tabs(est_now)

    generated_files = []
    for title, rows in tabs:
        detected, pool = detect_and_scrub_with_guardrails(
            title, rows, bq_stats, manual_fades, min_mpg=args.min_mpg, min_gp=args.min_gp
        )
        print(f"🛰️  TAB: '{title}' | Vetted Rotation Pool: {len(pool)} Active Players")
        targets = [detected] if args.provider == "auto" else (["DK", "FD"] if args.provider == "both" else [args.provider.upper()])
        for prov in targets:
            generated_files.append(solve_and_write_csv(pool, prov, args.lineups, date_iso))

    if os.system("command -v cloudshell >/dev/null 2>&1") == 0 and generated_files:
        subprocess.run(["cloudshell", "download"] + generated_files, check=False)

if __name__ == "__main__":
    main()
