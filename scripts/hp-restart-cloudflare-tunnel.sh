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

echo "==> Restarting Cloudflare tunnel on ${HP_USER}@${HP_HOST}"

ssh "${HP_USER}@${HP_HOST}" <<EOF
set -euo pipefail
cd "${HP_BASE_DIR}/infra"

if [[ ! -f ".env.cloudflared" ]]; then
  echo "Missing ${HP_BASE_DIR}/infra/.env.cloudflared" >&2
  exit 1
fi

docker compose \
  --env-file .env.production \
  --env-file .env.cloudflared \
  -f docker-compose.yml \
  -f docker-compose-cloudflare.yml \
  up -d cloudflared

echo
echo "==> cloudflared status"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'NAMES|surfjudging_cloudflared|surfjudging$' || true

echo
echo "==> cloudflared logs"
docker logs --tail 80 surfjudging_cloudflared
EOF

echo
echo "Public display should be reachable at:"
echo "https://display.surfjudging.cloud/display"
