#!/usr/bin/env python3
"""sovereign_ingest.py: Manual terminal gatekeeper for DK CSV uploads (J8 / Row 7 Anchor + !SCRUB)."""
import csv
import json
import subprocess
import sys

REQUIRED_HEADERS = ['Position', 'Name + ID', 'Name', 'ID', 'Roster Position', 'Salary', 'Game Info', 'TeamAbbrev', 'AvgPointsPerGame']

def parse_and_scrub_dk_csv(csv_path, out_players=None, slate_timer_code=1):
    out_set = {p.strip().lower() for p in (out_players or [])}
    active_pool = []
    purged = []
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))

    anchor_idx = None
    col_start = 0
    for idx, row in enumerate(rows[:15]):
        cleaned_row = [c.strip() for c in row]
        if 'Position' in cleaned_row and 'Name + ID' in cleaned_row:
            anchor_idx = idx
            col_start = cleaned_row.index('Position')
            break

    if anchor_idx is None:
        raise ValueError("J8 / Row 7 Anchor ('Position') not found in first 15 rows.")

    headers = [h.strip() for h in rows[anchor_idx][col_start:col_start + 9]]
    for r in rows[anchor_idx + 1:]:
        chunk = r[col_start:col_start + 9]
        if len(chunk) < 9 or not chunk[2].strip():
            continue
        record = dict(zip(headers, [c.strip() for c in chunk]))
        if record['Name'].lower() in out_set:
            purged.append(record['Name'])
            continue
        raw_sal = record['Salary'].replace('$', '').replace(',', '').strip()
        record['Salary'] = int(float(raw_sal)) if raw_sal else 3000
        record['Slate_Timer_Code'] = int(slate_timer_code)
        active_pool.append(record)

    print(f"✅ !SCRUB COMPLETE (Slate Timer {slate_timer_code}): {len(active_pool)} active players retained | {len(purged)} OUT players purged.")
    return active_pool

if __name__ == "__main__":
    if len(sys.argv) > 1:
        parse_and_scrub_dk_csv(sys.argv[1], sys.argv[2:])
    else:
        print("✅ sovereign_ingest.py online. Usage: python3 ~/ava-mcp-agent/sovereign_ingest.py <DKSalaries.csv> [OutPlayer1 ...]")
