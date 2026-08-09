#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="surfjudging-p266b-pg15-$$"
POSTGRES_PASSWORD="p266b-isolated-postgres"
POSTGRES_IMAGE="${P2_POSTGRES_IMAGE:-supabase/postgres:15.1.0.147}"
EXPECTED_MAJOR="${P2_EXPECTED_POSTGRES_MAJOR:-15}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

ready_count=0
until [[ "$ready_count" -ge 5 ]]; do
  if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready_count=$((ready_count + 1))
  else
    ready_count=0
  fi
  sleep 1
done

apply_sql() {
  docker exec -i "$CONTAINER_NAME" \
    psql --single-transaction -v ON_ERROR_STOP=1 -U postgres -d postgres < "$1" >/dev/null
}

while IFS= read -r migration; do
  apply_sql "$migration"
done < <(find "$ROOT_DIR/backend/supabase/migrations" -maxdepth 1 -name '*.sql' \
  ! -name '._*' ! -name 'TEST_MIGRATIONS.sql' | sort)

apply_sql "$ROOT_DIR/backend/supabase/tests/p2_6_6b_authoritative_deployment_mode.sql"
apply_sql "$ROOT_DIR/backend/supabase/tests/p2_6_6c_cloud_test_activation.sql"
apply_sql "$ROOT_DIR/backend/supabase/tests/p2_6_6g_events_rls_ownership_isolation.sql"
apply_sql "$ROOT_DIR/backend/sql/PROVISION_FIELD_DEPLOYMENT_MODE.sql"
apply_sql "$ROOT_DIR/backend/supabase/tests/atomic_safe_planning_heat_configs.sql"

mode="$(docker exec "$CONTAINER_NAME" psql -At -U postgres -d postgres \
  -c 'select public.get_authoritative_deployment_mode()')"
version="$(docker exec "$CONTAINER_NAME" psql -At -U postgres -d postgres \
  -c 'show server_version_num')"

if [[ "$mode" != "field" || "$version" != "$EXPECTED_MAJOR"* ]]; then
  echo "Unexpected PostgreSQL result: version=$version mode=$mode expected_major=$EXPECTED_MAJOR" >&2
  exit 1
fi

echo "PostgreSQL authoritative mode + events RLS reconstruction: PASS (version=$version, mode=$mode)"
