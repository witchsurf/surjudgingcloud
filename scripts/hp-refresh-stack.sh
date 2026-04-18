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

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Syncing stack files to ${HP_USER}@${HP_HOST}"
rsync -az \
  "$ROOT_DIR/infra/docker-compose-local.yml" \
  "$ROOT_DIR/infra/kong.yml" \
  "$ROOT_DIR/infra/nginx.conf" \
  "$ROOT_DIR/backend/sql/PATCH_LOCAL_MISSING_OBJECTS.sql" \
  "$ROOT_DIR/backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql" \
  "$ROOT_DIR/backend/sql/FIX_SYNC_SCORING.sql" \
  "$ROOT_DIR/backend/sql/14_ADD_INTERFERENCE_CALLS.sql" \
  "$ROOT_DIR/backend/sql/UPGRADE_SYNC_SCHEMA_20260417.sql" \
  "$ROOT_DIR/backend/sql/UPGRADE_LOCAL_HEAT_WORKFLOW_20260418.sql" \
  "$ROOT_DIR/backend/supabase/migrations/20260417223000_move_qualifier_propagation_to_db.sql" \
  "$ROOT_DIR/backend/supabase/migrations/20260418192000_support_best_second_qualifier_propagation.sql" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/"

echo "==> Refreshing HP local stack"
ssh "${HP_USER}@${HP_HOST}" <<EOF
set -euo pipefail
cd "${HP_BASE_DIR}"

mkdir -p infra backend/sql

if [ -f docker-compose-local.yml ]; then
  mv docker-compose-local.yml infra/docker-compose-local.yml
fi
if [ -f kong.yml ]; then
  mv kong.yml infra/kong.yml
fi
if [ -f nginx.conf ]; then
  mv nginx.conf infra/nginx.conf
fi
for sql in PATCH_LOCAL_MISSING_OBJECTS.sql FIX_LOCAL_SYNC_SCHEMA.sql FIX_SYNC_SCORING.sql 14_ADD_INTERFERENCE_CALLS.sql UPGRADE_SYNC_SCHEMA_20260417.sql UPGRADE_LOCAL_HEAT_WORKFLOW_20260418.sql 20260417223000_move_qualifier_propagation_to_db.sql 20260418192000_support_best_second_qualifier_propagation.sql; do
  if [ -f "\$sql" ]; then
    mv "\$sql" "backend/sql/\$sql"
  fi
done

cd infra
docker compose -f docker-compose-local.yml up -d postgres auth realtime storage rest kong
docker compose -f docker-compose-local.yml stop meta studio >/dev/null 2>&1 || true

until docker exec surfjudging_postgres pg_isready -U postgres >/dev/null 2>&1; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

for sql_file in \
  "${HP_BASE_DIR}/backend/sql/PATCH_LOCAL_MISSING_OBJECTS.sql" \
  "${HP_BASE_DIR}/backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql" \
  "${HP_BASE_DIR}/backend/sql/FIX_SYNC_SCORING.sql" \
  "${HP_BASE_DIR}/backend/sql/14_ADD_INTERFERENCE_CALLS.sql" \
  "${HP_BASE_DIR}/backend/sql/UPGRADE_SYNC_SCHEMA_20260417.sql" \
  "${HP_BASE_DIR}/backend/sql/UPGRADE_LOCAL_HEAT_WORKFLOW_20260418.sql" \
  "${HP_BASE_DIR}/backend/sql/20260417223000_move_qualifier_propagation_to_db.sql" \
  "${HP_BASE_DIR}/backend/sql/20260418192000_support_best_second_qualifier_propagation.sql"
do
  if [ -f "\${sql_file}" ]; then
    echo "Applying \$(basename "\${sql_file}")"
    docker exec -i surfjudging_postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "\${sql_file}"
  fi
done

docker compose -f docker-compose-local.yml restart rest kong >/dev/null 2>&1 || true
docker compose -f docker-compose-local.yml ps
EOF

echo "==> HP stack refresh completed"
