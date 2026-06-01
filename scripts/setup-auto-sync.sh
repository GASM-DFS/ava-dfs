#!/usr/bin/env bash

# Ava-DFS: Automated Schedule Setup
# Description: Configures a background task (cron job) to run the sync script daily.

CRON_JOB="0 17 * * * /home/ava-dfs/Documents/GitHub/ava-dfs/scripts/sync-repo.sh 'Automated end-of-day sync' >> /tmp/auto-sync.log 2>&1"
# Time settings (24-hour format). Change these variables to your preferred time!
MINUTE="0"
HOUR="17" # Example: 17 = 5:00 PM, 14 = 2:00 PM, 9 = 9:00 AM

# Check if the job is already installed to prevent duplicates
if crontab -l 2>/dev/null | grep -q "sync-repo.sh"; then
  echo "✅ Your automated daily sync is already scheduled!"
  exit 0
fi
CRON_JOB="$MINUTE $HOUR * * * /home/ava-dfs/Documents/GitHub/ava-dfs/scripts/sync-repo.sh 'Automated end-of-day sync' >> /tmp/auto-sync.log 2>&1"

# Add the newly configured schedule (safely avoiding duplicates)
(crontab -l 2>/dev/null | grep -v "sync-repo.sh"; echo "$CRON_JOB") | crontab -

# Helper to format the output nicely for you
AM_PM="AM"
DISPLAY_HOUR=$HOUR
if [ $HOUR -ge 12 ]; then AM_PM="PM"; fi
if [ $HOUR -gt 12 ]; then DISPLAY_HOUR=$((HOUR - 12)); fi
if [ $HOUR -eq 0 ]; then DISPLAY_HOUR=12; fi

echo "🎉 Success! Your changes will now automatically sync to the cloud every day at $DISPLAY_HOUR:$(printf "%02d" $MINUTE) $AM_PM."