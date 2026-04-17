#!/usr/bin/env bash
set -euo pipefail

HP_PROFILE="${SURF_HP_PROFILE:-field}"
if [[ -n "${SURF_HP_HOST:-}" ]]; then
  HP_HOST="${SURF_HP_HOST}"
elif [[ "$HP_PROFILE" == "home" ]]; then
  HP_HOST="10.0.0.28"
else
  HP_HOST="192.168.1.2"
fi
HP_USER="${SURF_HP_USER:-admin-surfjudging}"
HP_BASE_DIR="${SURF_HP_BASE_DIR:-/home/admin-surfjudging/surjudgingcloud}"
HP_DIST_STAGING="${SURF_HP_DIST_STAGING:-/home/admin-surfjudging/judging-dist}"
CONTAINER_NAME="${SURF_HP_WEB_CONTAINER:-surfjudging}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "==> Building frontend locally"
cd "$FRONTEND_DIR"
npm run build

LOCAL_BUNDLE="$(grep -oE '/assets/index-[^"]+\.js' dist/index.html | head -n 1 | sed 's#^/assets/##')"

if [[ -z "$LOCAL_BUNDLE" ]]; then
  echo "Unable to detect local frontend bundle from dist/index.html" >&2
  exit 1
fi

echo "==> Syncing dist to ${HP_USER}@${HP_HOST}:${HP_DIST_STAGING}"
rsync -az --delete "$FRONTEND_DIR/dist/" "${HP_USER}@${HP_HOST}:${HP_DIST_STAGING}/"

echo "==> Updating container ${CONTAINER_NAME}"
ssh "${HP_USER}@${HP_HOST}" "docker cp '${HP_DIST_STAGING}/.' '${CONTAINER_NAME}:/usr/share/nginx/html/' && docker exec '${CONTAINER_NAME}' nginx -s reload >/dev/null"

echo "==> Verifying served bundle on HP"
REMOTE_BUNDLE="$(ssh "${HP_USER}@${HP_HOST}" "grep -oE '/assets/index-[^\"]+\\.js' '${HP_DIST_STAGING}/index.html' | head -n 1 | sed 's#^/assets/##'")"

SERVED_BUNDLE="$(ssh "${HP_USER}@${HP_HOST}" "curl -fsS http://localhost:8080 | grep -oE '/assets/index-[^\"]+\\.js' | head -n 1 | sed 's#^/assets/##'")"

echo "Local build bundle : $LOCAL_BUNDLE"
echo "HP staged bundle   : $REMOTE_BUNDLE"
echo "HP served bundle   : $SERVED_BUNDLE"

if [[ "$LOCAL_BUNDLE" != "$SERVED_BUNDLE" ]]; then
  echo "Bundle mismatch after HP deploy" >&2
  exit 1
fi

echo "==> Frontend deploy on HP completed successfully"
