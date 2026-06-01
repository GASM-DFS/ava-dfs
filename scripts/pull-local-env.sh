#!/usr/bin/env bash
set -e

PROJECT_ID="gasm-481006"
SECRETS=("SPORTS_API_KEY" "VERTEX_ENDPOINT_ID" "ODDS_API_KEY" "SPREADSHEET_ID" "SLACK_WEBHOOK_URL")
ENV_FILE="$(dirname "$0")/../.env"

echo "📥 Pulling Ava-DFS secrets from GCP Secret Manager..."

> "$ENV_FILE"

for SECRET_NAME in "${SECRETS[@]}"; do
  SECRET_VALUE=$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT_ID")
  echo "$SECRET_NAME=$SECRET_VALUE" >> "$ENV_FILE"
done

echo "✅ Success! Secrets written to $ENV_FILE"