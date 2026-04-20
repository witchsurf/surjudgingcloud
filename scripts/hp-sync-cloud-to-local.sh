#!/usr/bin/env bash
set -euo pipefail

PROFILE="home"
SKIP_REPAIR="0"
SKIP_HEALTHCHECK="0"

usage() {
  cat <<'EOF'
Usage: ./scripts/hp-sync-cloud-to-local.sh [--home|--field] [--skip-repair] [--skip-healthcheck]

Copies the Cloud Supabase database into the HP local Supabase database.

This script is intentionally DB-only:
  - no frontend build
  - no Docker stack refresh
  - no code deployment

Profiles:
  --home   HP on home LAN: 10.0.0.28 (default)
  --field  HP on D-LINK / beach LAN: 192.168.1.2
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)
      PROFILE="home"
      ;;
    --field)
      PROFILE="field"
      ;;
    --skip-repair)
      SKIP_REPAIR="1"
      ;;
    --skip-healthcheck)
      SKIP_HEALTHCHECK="1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [[ -n "${SURF_HP_HOST:-}" ]]; then
  HP_HOST="$SURF_HP_HOST"
elif [[ "$PROFILE" == "field" ]]; then
  HP_HOST="192.168.1.2"
else
  HP_HOST="10.0.0.28"
fi

export SURF_HP_PROFILE="$PROFILE"
export SURF_HP_HOST="$HP_HOST"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_env_file "$FRONTEND_DIR/.env.production"
load_env_file "$FRONTEND_DIR/.env.local"

# Always target the selected HP profile, regardless of the LAN URL stored in env files.
export VITE_SUPABASE_URL_LAN="http://${HP_HOST}:8000"

echo "======================================================"
echo "📦 HP Cloud -> Local Supabase Sync"
echo "Profile : $PROFILE"
echo "HP host : $HP_HOST"
echo "Local   : $VITE_SUPABASE_URL_LAN"
echo "======================================================"

echo
echo "==> Preflight network"
if ! ping -c 1 -W 1000 "$HP_HOST" >/dev/null 2>&1; then
  echo "HP is not reachable on $HP_HOST" >&2
  exit 1
fi

if ! nc -zvw2 "$HP_HOST" 8000 >/dev/null 2>&1; then
  echo "Local Supabase API is not reachable on $HP_HOST:8000" >&2
  echo "Run ./scripts/hp-refresh-stack.sh only if the HP stack is actually down." >&2
  exit 1
fi

if [[ -z "${VITE_SUPABASE_URL_CLOUD:-}" || -z "${VITE_SUPABASE_ANON_KEY_CLOUD:-}" || -z "${VITE_SUPABASE_ANON_KEY_LAN:-}" ]]; then
  echo "Missing Supabase environment variables. Check frontend/.env.local or frontend/.env.production." >&2
  exit 1
fi

echo
echo "==> Copying Cloud Supabase to HP local Supabase"
(cd "$FRONTEND_DIR" && node scripts/hp-photocopy-db.mjs)

if [[ "$SKIP_REPAIR" != "1" ]]; then
  echo
  echo "==> Repairing qualifier hydration if needed"
  (cd "$FRONTEND_DIR" && node scripts/repair-broken-qualifiers.mjs --target=local)
fi

if [[ "$SKIP_HEALTHCHECK" != "1" ]]; then
  echo
  echo "==> Final HP healthcheck"
  (cd "$ROOT_DIR" && ./scripts/hp-healthcheck.sh)
fi

echo
echo "Cloud -> HP local Supabase sync completed successfully."
