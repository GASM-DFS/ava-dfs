#!/usr/bin/env bash

# Ava-DFS: Quick Code Sync Utility
# Description: Automates saving and pushing changes to GitHub for non-technical users.
# Usage: ./scripts/sync-repo.sh "Your update message here"

# Ensure we are operating inside the correct repository folder before running commands
REPO_DIR="/home/ava-dfs/Documents/GitHub/ava-dfs"
cd "$REPO_DIR" || exit 1

echo "🚀 Starting synchronization with GitHub..."

# 1. Check if there are any changes to save
if [[ -z $(git status -s) ]]; then
  echo "✅ No changes detected. Everything is already up to date!"
  exit 0
fi

# 2. Add all new, modified, or deleted files to the staging area
git add .

# 3. Commit the changes with the provided message, or a default timestamp
MESSAGE=${1:-"Auto-sync backup on $(TZ='America/New_York' date +'%Y-%m-%d %H:%M:%S EST')"}
git commit -m "$MESSAGE"

# 4. Push the saved changes up to the remote repository
echo "☁️ Pushing changes to the cloud..."
git push

echo "🎉 Success! All your changes have been securely saved to the repository."