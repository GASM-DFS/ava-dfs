#!/usr/bin/env bash
set -e

PROJECT_ID="gasm-481006"
GITHUB_SERVICE_ACCOUNT="ava-dfs@gasm-481006.iam.gserviceaccount.com"
COMPUTE_SERVICE_ACCOUNT="218987434388-compute@developer.gserviceaccount.com"
SECRETS=("SPORTS_API_KEY" "VERTEX_ENDPOINT_ID" "ODDS_API_KEY" "SPREADSHEET_ID" "SLACK_WEBHOOK_URL" "API_KEYS" "JWT_SECRET")

echo "🔐 Ava-DFS Secret Manager Setup"
echo "================================="

for SECRET_NAME in "${SECRETS[@]}"; do
  echo "Please enter the value for $SECRET_NAME:"
  read -s SECRET_VALUE

  # Defensive check: Do not create empty secret payloads
  if [[ -z "$SECRET_VALUE" ]]; then
    echo "⚠️  No value provided for $SECRET_NAME. Skipping..."
    continue
  fi

  # Create secret container if it doesn't exist
  if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating secret $SECRET_NAME..."
    gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project="$PROJECT_ID"
  fi

  # Add the new payload version
  echo -n "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" --data-file=- --project="$PROJECT_ID"

  # Bind IAM Policy for GitHub Actions Service Account
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member="serviceAccount:$GITHUB_SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" >/dev/null

  # Bind IAM Policy for Cloud Run Compute Service Account
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member="serviceAccount:$COMPUTE_SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" >/dev/null

  echo "✅ Secret $SECRET_NAME configured and access granted."
  echo "---------------------------------"
done