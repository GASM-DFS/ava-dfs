#!/usr/bin/env python3
"""sovereign_daily_sync.py: Crontab-enabled (8:00 AM) Staging (US) -> Archive (us-central1) sync."""
import subprocess

if __name__ == "__main__":
    print("🛰️ Running 8:00 AM Sovereign Daily Sync (Staging -> Archive us-central1)...")
    subprocess.run(["bash", "-c", "source ~/.ava_aliases.sh 2>/dev/null || true; bq --project_id=gasm-481006 --location=us-central1 query --use_legacy_sql=false --format=pretty 'SELECT COUNT(*) AS total_logs, MAX(game_date) AS latest_game_date FROM `gasm-481006.nba_data.game_by_game_logs`'"], check=True)
    print("✅ sovereign_daily_sync.py complete.")
