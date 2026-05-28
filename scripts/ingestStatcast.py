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
import urllib.request
import urllib.error

def die(msg):
    sys.stderr.write(f"Error: {msg}\n")
    sys.exit(1)

def validate_date(date_str):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        die(f"Invalid date format: '{date_str}'. Must be strictly YYYY-MM-DD.")

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Ava-DFS-GASM/1.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as e:
        die(f"Network error fetching {url}: {str(e)}")

def main():
    parser = argparse.ArgumentParser(description="Ava-DFS: MLB Statcast Advanced Metrics Ingestor")
    parser.add_argument("--date", required=True, help="Target date in YYYY-MM-DD format")
    args = parser.parse_args()

    validate_date(args.date)

    try:
        sys.stderr.write(f"⚾ Fetching MLB Schedule for {args.date} from StatsAPI...\n")
        
        # 1. Fetch Schedule to get game IDs
        schedule_url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={args.date}"
        schedule_data = fetch_json(schedule_url)
        
        dates = schedule_data.get('dates', [])
        if not dates:
            sys.stderr.write(f"⚠️ Warning: No MLB games scheduled for {args.date}.\n")
            print(json.dumps([]))
            return
            
        games = dates[0].get('games', [])
        records = []
        
        # 2. Iterate and fetch Play-by-Play for each game
        for game in games:
            game_pk = game.get('gamePk')
            if not game_pk:
                continue
                
            sys.stderr.write(f"📊 Fetching Play-by-Play for Game {game_pk}...\n")
            pbp_url = f"https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"
            pbp_data = fetch_json(pbp_url)
            
            all_plays = pbp_data.get('liveData', {}).get('plays', {}).get('allPlays', [])
            
            for play in all_plays:
                matchup = play.get('matchup', {})
                batter_name = matchup.get('batter', {}).get('fullName')
                batter_id = matchup.get('batter', {}).get('id')
                pitcher_id = matchup.get('pitcher', {}).get('id')
                
                event = play.get('result', {}).get('event')
                play_events = play.get('playEvents', [])
                
                for i, pe in enumerate(play_events):
                    if pe.get('isPitch'):
                        details = pe.get('details', {})
                        pitch_data = pe.get('pitchData', {})
                        hit_data = pe.get('hitData', {})
                        
                        is_last_pitch = (i == len(play_events) - 1)
                        
                        record = {
                            'game_date': args.date,
                            'player_name': batter_name,
                            'batter': batter_id,
                            'pitcher': pitcher_id,
                            'events': event if is_last_pitch else None,
                            'description': details.get('description'),
                            'pitch_type': details.get('type', {}).get('code'),
                            'release_speed': pitch_data.get('startSpeed'),
                            'launch_speed': hit_data.get('launchSpeed'),
                            'launch_angle': hit_data.get('launchAngle'),
                            'estimated_ba_using_speedangle': None # Fallback as StatsAPI omits xBA
                        }
                        records.append(record)
        
        sys.stdout.write(json.dumps(records, indent=2) + '\n')

    except Exception as e:
        die(f"Execution error during StatsAPI fetch: {str(e)}")

if __name__ == "__main__":
    main()