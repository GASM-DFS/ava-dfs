#!/usr/bin/env bash

# Ava-DFS: Automated Schedule Setup
# Description: Configures a background task (cron job) to run the sync script daily.

CRON_JOB="0 17 * * * /home/ava-dfs/Documents/GitHub/ava-dfs/scripts/sync-repo.sh 'Automated end-of-day sync' >> /tmp/auto-sync.log 2>&1"

# Check if the job is already installed to prevent duplicates
if crontab -l 2>/dev/null | grep -q "sync-repo.sh"; then
  echo "✅ Your automated daily sync is already scheduled!"
  exit 0
fi

# Add the daily 5:00 PM schedule to the system's background task list
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
echo "🎉 Success! Your changes will now automatically sync to the cloud every day at 5:00 PM."