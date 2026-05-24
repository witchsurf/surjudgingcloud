#!/usr/bin/env bash
set -euo pipefail

HP_PROFILE="${SURF_HP_PROFILE:-field}"
if [[ -n "${SURF_HP_HOST:-}" ]]; then
  HP_HOST="${SURF_HP_HOST}"
elif [[ "$HP_PROFILE" == "home" ]]; then
  HP_HOST="10.0.0.14"
else
  HP_HOST="192.168.1.2"
fi
HP_USER="${SURF_HP_USER:-admin-surfjudging}"
DISPLAY_URL="${SURF_HP_DISPLAY_URL:-https://display.surfjudging.cloud/display}"
LOCAL_DISPLAY_URL="http://${HP_HOST}:8080/display"
LOCAL_API_URL="http://${HP_HOST}:8000/rest/v1/events?select=id&limit=1"
SCHEMA_URL="http://${HP_HOST}:8000/rest/v1/app_runtime_schema_version?select=schema_version,updated_at&limit=1"
LEGACY_HP_IP="${SURF_HP_LEGACY_IP:-$([[ "$HP_HOST" == "192.168.1.2" ]] && echo "10.0.0.14" || echo "192.168.1.2")}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

section() {
  printf '\n== %s ==\n' "$1"
}

extract_bundle() {
  grep -oE '/assets/index-[^"]+\.js' | head -n 1 | sed 's#^/assets/##'
}

expected_schema_version() {
  local latest_migration
  latest_migration="$(find "$ROOT_DIR/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "TEST_MIGRATIONS.sql" | sort | tail -n 1)"
  basename "$latest_migration" .sql
}

extract_schema_version() {
  sed -n 's/.*"schema_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

section "Network"
for target in "$HP_HOST" "$LEGACY_HP_IP"; do
  printf '%s: ' "$target"
  if ping -c 1 -W 1000 "$target" >/dev/null 2>&1; then
    echo "ping ok"
  else
    echo "ping fail"
  fi
done

section "Ports"
for port in 22 8080 8000; do
  if nc -zvw2 "$HP_HOST" "$port" >/dev/null 2>&1; then
    echo "$HP_HOST:$port ok"
  else
    echo "$HP_HOST:$port FAIL"
  fi
done

section "Docker services"
ssh "${HP_USER}@${HP_HOST}" "docker ps --format 'table {{.Names}}\t{{.Status}}' | sed -n '1,20p'"

section "Local web/API"
curl -fsSI "http://${HP_HOST}:8080" | sed -n '1,8p'
echo "---"
curl -fsS "$LOCAL_API_URL" | head -c 300; echo

section "Runtime schema"
EXPECTED_SCHEMA="$(expected_schema_version)"
INSTALLED_SCHEMA="$(curl -fsS "$SCHEMA_URL" | extract_schema_version)"
echo "Expected schema : $EXPECTED_SCHEMA"
echo "Installed schema: ${INSTALLED_SCHEMA:-missing}"
if [[ "$INSTALLED_SCHEMA" != "$EXPECTED_SCHEMA" ]]; then
  echo "Runtime schema: MISMATCH" >&2
  exit 1
fi
echo "Runtime schema: OK"

section "Bundle alignment"
LOCAL_BUNDLE="$(curl -fsS "$LOCAL_DISPLAY_URL" | extract_bundle)"
PUBLIC_BUNDLE="$(curl -fsS --connect-timeout 4 "$DISPLAY_URL" 2>/dev/null | extract_bundle || true)"
echo "HP local display bundle : ${LOCAL_BUNDLE:-missing}"
echo "Public display bundle   : ${PUBLIC_BUNDLE:-Cloud offline / no internet}"

if [[ -z "$PUBLIC_BUNDLE" ]]; then
  echo "Bundle alignment: SKIPPED (Cloud offline / no internet)"
elif [[ -n "$LOCAL_BUNDLE" && "$LOCAL_BUNDLE" == "$PUBLIC_BUNDLE" ]]; then
  echo "Bundle alignment: OK"
else
  echo "Bundle alignment: MISMATCH"
fi

section "Legacy IP sanity"
if nc -zvw2 "$LEGACY_HP_IP" 22 >/dev/null 2>&1 || nc -zvw2 "$LEGACY_HP_IP" 8080 >/dev/null 2>&1 || nc -zvw2 "$LEGACY_HP_IP" 8000 >/dev/null 2>&1; then
  echo "Legacy IP ${LEGACY_HP_IP} still exposes services: review network assumptions"
else
  echo "Legacy IP ${LEGACY_HP_IP} inactive for SSH/web/API"
fi
