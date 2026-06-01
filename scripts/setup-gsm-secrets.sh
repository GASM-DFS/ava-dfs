#!/usr/bin/env bash
set -e

PROJECT_ID="gasm-481006"
SERVICE_ACCOUNT="ava-dfs@gasm-481006.iam.gserviceaccount.com"
SECRETS=("SPORTS_API_KEY" "VERTEX_ENDPOINT_ID" "ODDS_API_KEY")

echo "🔐 Ava-DFS Secret Manager Setup"
echo "================================="

for SECRET_NAME in "${SECRETS[@]}"; do
  echo "Please enter the value for $SECRET_NAME:"
  read -s SECRET_VALUE

  # Create secret container if it doesn't exist
  if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating secret $SECRET_NAME..."
    gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project="$PROJECT_ID"
  fi

  # Add the new payload version
  echo -n "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" --data-file=- --project="$PROJECT_ID"

  # Bind IAM Policy for Cloud Run Service Account
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" >/dev/null

  echo "✅ Secret $SECRET_NAME configured and access granted."
  echo "---------------------------------"
done