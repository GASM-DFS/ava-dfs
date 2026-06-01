#!/usr/bin/env python3
import argparse
import pandas as pd
import json
import sys
from pybaseball import statcast
from datetime import datetime

def main():
    """
    Fetches MLB Statcast data for a given date, selects relevant columns,
    and outputs the data as a JSON array to stdout for BigQuery ingestion.
    """
    parser = argparse.ArgumentParser(description="Ingest MLB Statcast data for a specific date.")
    parser.add_argument("--date", required=True, help="Date in YYYY-MM-DD format")
    args = parser.parse_args()

    try:
        # Validate date format
        datetime.strptime(args.date, '%Y-%m-%d')
    except ValueError:
        print(f"Error: Invalid date format: '{args.date}'. Must be YYYY-MM-DD.", file=sys.stderr)
        sys.exit(1)

    print(f"⚾ Fetching MLB Statcast data for {args.date}...", file=sys.stderr)
    
    try:
        # Fetch data using pybaseball
        data = statcast(start_dt=args.date, end_dt=args.date)
    except Exception as e:
        print(f"Error: Failed to fetch data from Statcast API: {e}", file=sys.stderr)
        sys.exit(1)

    if data.empty:
        print(f"No Statcast data found for {args.date}. Exiting gracefully.", file=sys.stderr)
        # Output an empty JSON array to satisfy the data contract for downstream scripts
        print("[]")
        return

    # Define the schema of columns we want to keep for our fact table
    # This helps control the size and relevance of the data landing in BigQuery
    COLUMNS_TO_KEEP = [
        'game_date', 'game_pk', 'player_name', 'batter', 'pitcher', 'events',
        'description', 'zone', 'des', 'game_type', 'stand', 'p_throws',
        'home_team', 'away_team', 'type', 'hit_location', 'bb_type',
        'balls', 'strikes', 'inning', 'inning_topbot', 'pfx_x', 'pfx_z',
        'plate_x', 'plate_z', 'on_3b', 'on_2b', 'on_1b', 'outs_when_up',
        'hc_x', 'hc_y', 'vx0', 'vy0', 'vz0', 'ax', 'ay', 'az',
        'sz_top', 'sz_bot', 'effective_speed', 'release_speed', 'release_spin_rate',
        'release_pos_x', 'release_pos_z', 'launch_speed', 'launch_angle',
        'launch_speed_angle', 'estimated_ba_using_speedangle', 'estimated_woba_using_speedangle',
        'woba_value', 'woba_denom', 'babip_value', 'iso_value', 'at_bat_number', 'pitch_number'
    ]

    # Filter for columns that actually exist in the fetched data to avoid errors
    existing_columns = [col for col in COLUMNS_TO_KEEP if col in data.columns]
    df = data[existing_columns].copy()

    # Data Cleaning and Transformation for BigQuery compatibility
    # Convert float columns that might have NaNs to nullable integers where appropriate
    for col in ['batter', 'pitcher', 'on_3b', 'on_2b', 'on_1b']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')

    # Convert date to string to prevent JSON serialization issues
    if 'game_date' in df.columns:
        df['game_date'] = df['game_date'].astype(str)

    # Replace NaN with None (which becomes null in JSON) for cleaner data in BigQuery
    df = df.where(pd.notnull(df), None)

    # Convert DataFrame to a list of dictionaries (JSON records)
    records = df.to_dict(orient='records')

    # Output the JSON string to stdout
    print(json.dumps(records, indent=2))

if __name__ == "__main__":
    main()