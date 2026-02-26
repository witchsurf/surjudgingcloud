#!/usr/bin/env bash
set -euo pipefail

# Deploy canonical Supabase Edge Functions from backend/
# Usage:
#   ./scripts/deploy-supabase-functions.sh
#   ./scripts/deploy-supabase-functions.sh --project-ref xxxxx
#   ./scripts/deploy-supabase-functions.sh --with-secrets backend/supabase/.secrets/functions.env

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PROJECT_REF="xwaymumbkmwxqifihuvn"
SECRETS_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-ref)
      PROJECT_REF="${2:-}"
      shift 2
      ;;
    --with-secrets)
      SECRETS_FILE="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required."
  exit 1
fi

cd "$BACKEND_DIR"

echo "Linking project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

if [[ -n "$SECRETS_FILE" ]]; then
  if [[ ! -f "$ROOT_DIR/$SECRETS_FILE" && ! -f "$SECRETS_FILE" ]]; then
    echo "Secrets file not found: $SECRETS_FILE"
    exit 1
  fi

  if [[ -f "$ROOT_DIR/$SECRETS_FILE" ]]; then
    SECRETS_PATH="$ROOT_DIR/$SECRETS_FILE"
  else
    SECRETS_PATH="$SECRETS_FILE"
  fi

  echo "Pushing secrets from: $SECRETS_PATH"
  supabase secrets set --env-file "$SECRETS_PATH"
fi

echo "Deploying functions..."
supabase functions deploy payments
supabase functions deploy heat-sync
supabase functions deploy kiosk-bootstrap
supabase functions deploy stripe-webhook
supabase functions deploy health-check

echo "Deployment complete."
