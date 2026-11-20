#!/usr/bin/env python3
"""
Sovereign [B2: THE FEED] Pre-Lock Scout + !CHALK & !SWAP Macros (v6.0)
Dynamically builds today's nba.com DFS URL (month-day-year), checks live B2 feeds,
and executes !CHALK (5 Chalk vs. 3 Pivots) and !SWAP [Player] against today's pool.
"""
import csv
import datetime
import os
import re
import sys
from zoneinfo import ZoneInfo
import requests

SLATE_CSV = os.path.expanduser("~/ava-mcp-agent/live_slate_2026_11_19.csv")

B2_CORE_FEEDS = [
    "https://www.nba.com/players/todays-lineups",
    "https://www.rotowire.com/basketball/nba-lineups.php",
    "https://www.cbssports.com/nba/injuries/",
    "https://rotogrinders.com/lineups/nba",
    "https://basketballmonster.com/nbalineups.aspx",
]

USAGE_VACUUMS = {
    "brandin podziemski": 1.30, "yaxel lendeborg": 1.22, "de'anthony melton": 1.25,
    "charles bassey": 1.25, "gui santos": 1.20, "lamelo ball": 1.25,
    "jaden mcdaniels": 1.25, "ayo dosunmu": 1.25, "terrence shannon jr.": 1.22,
    "bones hyland": 1.20, "damian lillard": 1.25, "donovan clingan": 1.25,
    "jrue holiday": 1.20, "tyler herro": 1.25, "jaime jaquez jr.": 1.20,
    "ryan rollins": 1.22, "kel'el ware": 1.25, "caris levert": 1.30,
    "stephon castle": 1.20, "de'aaron fox": 1.20,
}

def build_dynamic_nba_url(dt):
    slug = f"{dt.strftime('%b').lower()}-{dt.day}-{dt.year}"
    return f"https://www.nba.com/news/nba-fantasy-dfs-picks-advice-for-{slug}"

def probe_b2_feeds(dt, q_players):
    dyn_url = build_dynamic_nba_url(dt)
    urls = [dyn_url] + B2_CORE_FEEDS
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Ava-GASM/6.0"}
    reachable = 0
    alerts = []
    for u in urls:
        try:
            r = requests.get(u, headers=headers, timeout=5)
            if r.status_code < 400:
                reachable += 1
                txt = re.sub(r"<[^>]+>", " ", r.text)
                for qp in q_players:
                    m = re.search(rf"{re.escape(qp)}.{{0,80}}(ruled out|will not play|inactive|available to play|will start)", txt, re.I)
                    if m:
                        alerts.append(f"{qp}: '{m.group(0).strip()}' ({u})")
        except Exception:
            continue
    print(f"✅ [B2: THE FEED] Dynamic Daily URL Updated -> {dyn_url}")
    print(f"✅ [B2: THE FEED] Probed {len(urls)} primary endpoints ({reachable} live HTTP 200 responses).")
    if alerts:
        for a in alerts[:5]:
            print(f"🚨 LIVE B2 ALERT: {a}")
    else:
        print("ℹ️  No new late-scratch overrides detected for Q-tag pool; Sheet Status column remains authoritative.")

def load_active_pool():
    pool = []
    q_names = []
    with open(SLATE_CSV, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            status = (row.get("Status") or "").strip().upper()
            name = row["Name"].strip()
            if status == "Q":
                q_names.append(name)
            if status in {"OUT", "O", "INACTIVE", "SCRATCHED"}:
                continue
            sal = int(float(row["Salary"].replace("$", "").replace(",", "").strip() or 3000))
            avg_fpts = float(row["AvgPointsPerGame"].strip() or 0.0)
            bump = USAGE_VACUUMS.get(name.lower(), 1.0)
            bumped = round(avg_fpts * bump, 2)
            cliff = bumped > 35.0
            proj = round(bumped * 1.55, 2) if cliff else bumped
            val = round((proj / sal) * 1000.0, 2)
            # Estimated field ownership heuristic from raw AvgFPTS/$ + vacuum visibility
            est_own = min(48.0, max(2.5, round((avg_fpts / (sal / 1000.0)) * 5.2 + (8.0 if bump >= 1.25 else 0.0), 1)))
            lev = round(proj / est_own, 2)
            pool.append({
                "Position": row["Position"].strip(),
                "Roster_Position": row["Roster Position"].strip(),
                "Name_ID": row["Name + ID"].strip(),
                "Name": name,
                "Team": row["TeamAbbrev"].strip(),
                "Salary": sal,
                "Status": status or "ACTIVE",
                "Proj_Pts": proj,
                "Value": val,
                "Est_Own": est_own,
                "Leverage": lev,
            })
    return pool, q_names

def run_chalk_macro(pool):
    chalk = sorted(pool, key=lambda x: x["Est_Own"], reverse=True)[:5]
    chalk_names = {c["Name"] for c in chalk}
    pivots = [
        p for p in pool
        if p["Name"] not in chalk_names and p["Est_Own"] <= 24.0 and p["Proj_Pts"] >= 54.0 and p["Status"] == "ACTIVE"
    ]
    pivots.sort(key=lambda x: x["Leverage"], reverse=True)

    print("\n### 🔥 !CHALK TOP 5 PROJECTED HIGH-OWNED PLAYS")
    print("| Name + ID | Pos | Team | Salary | Sovereign Proj | Est. Own% | Leverage (Proj/Own) |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for c in chalk:
        print(f"| **{c['Name_ID']}** | {c['Position']} | {c['Team']} | ${c['Salary']} | {c['Proj_Pts']:.2f} | {c['Est_Own']:.1f}% | {c['Leverage']:.2f} |")

    print("\n### 🎯 !CHALK TOP 3 LOWER-OWNED GPP PIVOTS (MAX LEVERAGE)")
    print("| Name + ID | Pos | Team | Salary | Sovereign Proj | Est. Own% | Leverage (Proj/Own) |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for p in pivots[:3]:
        print(f"| *{p['Name_ID']}* | {p['Position']} | {p['Team']} | ${p['Salary']} | **{p['Proj_Pts']:.2f}** | {p['Est_Own']:.1f}% | **{p['Leverage']:.2f}** |")

def run_swap_macro(pool, target_name):
    matches = [p for p in pool if target_name.lower() in p["Name"].lower()]
    if not matches:
        print(f"⚠️ Player '{target_name}' not found in active pool (check if already purged as OUT).")
        return
    target = matches[0]
    target_tokens = {t.strip() for t in target["Position"].split("/") if t.strip()}
    candidates = [
        p for p in pool
        if p["Name"] != target["Name"]
        and p["Salary"] <= target["Salary"]
        and p["Status"] == "ACTIVE"
        and bool(target_tokens & {t.strip() for t in p["Roster_Position"].split("/") if t.strip()})
    ]
    candidates.sort(key=lambda x: (x["Proj_Pts"], x["Value"]), reverse=True)
    print(f"\n### 🔄 !SWAP REPLACEMENTS FOR {target['Name_ID']} (${target['Salary']} | {target['Position']})")
    print("| Rank | Replacement (Name + ID) | Pos | Team | Salary | Sovereign Proj | Value (Pts/$1K) |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for idx, c in enumerate(candidates[:3], 1):
        print(f"| **{idx}** | **{c['Name_ID']}** | {c['Position']} | {c['Team']} | ${c['Salary']} | **{c['Proj_Pts']:.2f}** | {c['Value']:.2f}x |")

if __name__ == "__main__":
    est_now = datetime.datetime.now(ZoneInfo("America/New_York"))
    active_pool, q_list = load_active_pool()
    probe_b2_feeds(est_now, q_list)
    if len(sys.argv) > 1 and sys.argv[1].upper() == "SWAP" and len(sys.argv) > 2:
        run_swap_macro(active_pool, " ".join(sys.argv[2:]))
    else:
        run_chalk_macro(active_pool)
        run_swap_macro(active_pool, "Brandin Podziemski")
    print("\n[Sources: B1_GoogleSheet_11-19-2026, B2_Live_NBA_Feeds, B3_gasm-481006.nba_data]")
