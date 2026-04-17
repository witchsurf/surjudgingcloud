#!/usr/bin/env bash
set -euo pipefail

PROFILE="field"
FULL_STACK="0"
SKIP_DEPLOY="0"
SKIP_HEALTHCHECK="0"

usage() {
  cat <<'EOF'
Usage: ./scripts/field-ops.sh [--field|--home] [--full-stack] [--skip-deploy] [--skip-healthcheck]

Defaults:
  --field          Use HP on D-LINK / beach LAN (192.168.1.2)
  --home           Use HP on home LAN (10.0.0.28)
  --full-stack     Also refresh the HP local stack before frontend deploy
  --skip-deploy    Do not rebuild/redeploy the frontend artifact
  --skip-healthcheck
                   Skip the final healthcheck
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --field)
      PROFILE="field"
      ;;
    --home)
      PROFILE="home"
      ;;
    --full-stack)
      FULL_STACK="1"
      ;;
    --skip-deploy)
      SKIP_DEPLOY="1"
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
export SURF_HP_PROFILE="$PROFILE"

if [[ "$PROFILE" == "home" ]]; then
  HP_HOST="${SURF_HP_HOST:-10.0.0.28}"
else
  HP_HOST="${SURF_HP_HOST:-192.168.1.2}"
fi

echo "======================================================"
echo "🏄 Surf Judging Field Ops"
echo "Profile : $PROFILE"
echo "HP host : $HP_HOST"
echo "======================================================"

echo
echo "==> Preflight network"
if ! ping -c 1 -W 1000 "$HP_HOST" >/dev/null 2>&1; then
  echo "HP is not reachable on $HP_HOST" >&2
  exit 1
fi

if ! nc -zvw2 "$HP_HOST" 22 >/dev/null 2>&1; then
  echo "SSH is not reachable on $HP_HOST:22" >&2
  exit 1
fi

if [[ "$FULL_STACK" == "1" ]]; then
  echo
  echo "==> Refreshing full beach stack"
  (cd "$ROOT_DIR" && ./scripts/hp-refresh-stack.sh)
fi

if [[ "$SKIP_DEPLOY" != "1" ]]; then
  echo
  echo "==> Deploying frontend artifact to HP"
  (cd "$ROOT_DIR" && ./scripts/hp-deploy-frontend.sh)
fi

if [[ "$SKIP_HEALTHCHECK" != "1" ]]; then
  echo
  echo "==> Final healthcheck"
  (cd "$ROOT_DIR" && ./scripts/hp-healthcheck.sh)
fi

echo
echo "==> Useful URLs"
if [[ "$PROFILE" == "field" ]]; then
  echo "Local display : http://192.168.1.2:8080/display"
  echo "Local app     : http://192.168.1.2:8080"
  echo "Local API     : http://192.168.1.2:8000/rest/v1/events?select=id&limit=1"
else
  echo "Local display : http://10.0.0.28:8080/display"
  echo "Local app     : http://10.0.0.28:8080"
  echo "Local API     : http://10.0.0.28:8000/rest/v1/events?select=id&limit=1"
fi
echo "Public display: https://display.surfjudging.cloud/display"
echo "Cloud display : https://surfjudging.cloud/display"

echo
echo "Field ops completed successfully."
