#!/usr/bin/env python3

"""
Ava-DFS: MLB Statcast Advanced Metrics Ingestor

Usage:
  python3 scripts/ingestStatcast.py --date <YYYY-MM-DD>

Output:
  Writes a strict JSON array of pitch-by-pitch Statcast data to stdout.
"""

import argparse
import json
import sys
import re

def die(msg):
    sys.stderr.write(f"Error: {msg}\n")
    sys.exit(1)

try:
    from pybaseball import statcast
    import pandas as pd
except ImportError:
    die("Missing required Python packages. Please run: pip install pybaseball pandas")

def validate_date(date_str):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        die(f"Invalid date format: '{date_str}'. Must be strictly YYYY-MM-DD.")

def main():
    parser = argparse.ArgumentParser(description="Ava-DFS: MLB Statcast Advanced Metrics Ingestor")
    parser.add_argument("--date", required=True, help="Target date in YYYY-MM-DD format")
    args = parser.parse_args()

    validate_date(args.date)

    try:
        sys.stderr.write(f"⚾ Fetching Statcast data for {args.date}...\n")
        
        # pybaseball's statcast function natively scrapes Baseball Savant
        df = statcast(start_dt=args.date, end_dt=args.date, verbose=False)
        
        if df is None or df.empty:
            sys.stderr.write(f"⚠️ Warning: No Statcast data found for {args.date}.\n")
            print(json.dumps([]))
            return

        # Strict Data Contract: Select only highly correlated ML features for DFS models
        columns_to_keep = [
            'game_date', 'player_name', 'batter', 'pitcher', 'events', 
            'description', 'pitch_type', 'release_speed', 
            'launch_speed', 'launch_angle', 'estimated_ba_using_speedangle'
        ]
        
        # Defensively filter and map NaNs to None (JSON null)
        available_cols = [col for col in columns_to_keep if col in df.columns]
        records = df[available_cols].where(pd.notnull(df), None).to_dict(orient='records')
        
        sys.stdout.write(json.dumps(records, indent=2) + '\n')

    except Exception as e:
        die(f"Execution error during Statcast fetch: {str(e)}")

if __name__ == "__main__":
    main()