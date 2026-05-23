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

echo "==> Ensuring remote directories exist on ${HP_USER}@${HP_HOST}"
ssh "${HP_USER}@${HP_HOST}" "mkdir -p ${HP_BASE_DIR}/infra ${HP_BASE_DIR}/scripts ${HP_BASE_DIR}/frontend/scripts ${HP_BASE_DIR}/backend/sql ${HP_BASE_DIR}/backend/supabase/migrations"

echo "==> Syncing stack and migration files"
rsync -az \
  "$ROOT_DIR/infra/docker-compose-local.yml" \
  "$ROOT_DIR/infra/kong.yml" \
  "$ROOT_DIR/infra/nginx.conf" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/infra/"

rsync -az \
  "$ROOT_DIR/scripts/" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/scripts/"

rsync -az \
  "$ROOT_DIR/frontend/scripts/" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/frontend/scripts/"

rsync -az \
  "$ROOT_DIR/frontend/package.json" \
  "$ROOT_DIR/frontend/package-lock.json" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/frontend/"

rsync -az --delete \
  "$ROOT_DIR/backend/sql/" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/backend/sql/"

rsync -az --delete \
  "$ROOT_DIR/backend/supabase/migrations/" \
  "${HP_USER}@${HP_HOST}:${HP_BASE_DIR}/backend/supabase/migrations/"

echo "==> Refreshing HP local stack and applying migrations"
ssh "${HP_USER}@${HP_HOST}" <<EOF
set -euo pipefail
cd "${HP_BASE_DIR}/infra"

docker compose -f docker-compose-local.yml up -d postgres auth realtime storage rest kong
docker compose -f docker-compose-local.yml stop meta studio >/dev/null 2>&1 || true

until docker exec surfjudging_postgres pg_isready -U postgres >/dev/null 2>&1; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

if [ -f "${HP_BASE_DIR}/backend/sql/REPAIR_LOCAL_REALTIME_TENANT.sql" ]; then
  echo "==> Repairing local Realtime tenant alias"
  docker exec -i surfjudging_postgres sh -lc 'PGPASSWORD="${POSTGRES_PASSWORD:-your-super-secret-password}" psql -v ON_ERROR_STOP=1 -h localhost -U supabase_admin -d postgres' \
    < "${HP_BASE_DIR}/backend/sql/REPAIR_LOCAL_REALTIME_TENANT.sql"
fi

# Initialize tracking table for applied migrations.
# Do not use docker exec -i with psql -c inside this heredoc: it can consume
# the remaining SSH stdin and skip the rest of this script.
docker exec surfjudging_postgres psql -U postgres -d postgres -c "
CREATE TABLE IF NOT EXISTS public._local_applied_migrations (
  filename text PRIMARY KEY,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);"

psql_scalar() {
  docker exec surfjudging_postgres psql -t -A -U postgres -d postgres -c "\$1"
}

mark_sql_applied() {
  local base_name="\$1"
  docker exec surfjudging_postgres psql -U postgres -d postgres -c "
    INSERT INTO public._local_applied_migrations (filename) VALUES ('\$base_name') ON CONFLICT DO NOTHING;
  " >/dev/null
}

seed_tracking_if_runtime_is_current() {
  local latest_migration
  latest_migration=\$(find "${HP_BASE_DIR}/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "TEST_MIGRATIONS.sql" | sort | tail -n 1)
  if [ -z "\$latest_migration" ]; then
    return
  fi

  local latest_base
  latest_base=\$(basename "\$latest_migration")
  local tracked_count
  tracked_count=\$(psql_scalar "SELECT count(*) FROM public._local_applied_migrations WHERE filename ~ '^[0-9]';")

  if [ "\$tracked_count" -gt 5 ]; then
    return
  fi

  local has_runtime_table
  has_runtime_table=\$(psql_scalar "SELECT to_regclass('public.app_runtime_schema_version') IS NOT NULL;")
  if [ "\$has_runtime_table" != "t" ]; then
    return
  fi

  local runtime_version
  runtime_version=\$(psql_scalar "SELECT coalesce(schema_version, '') || '.sql' FROM public.app_runtime_schema_version LIMIT 1;")
  if [ "\$runtime_version" != "\$latest_base" ]; then
    return
  fi

  echo "==> Bootstrapping local migration tracker from installed runtime schema \$runtime_version"
  while IFS= read -r migration; do
    [ -n "\$migration" ] || continue
    mark_sql_applied "\$(basename "\$migration")"
  done <<MIGRATIONS
\$(find "${HP_BASE_DIR}/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "TEST_MIGRATIONS.sql" | sort)
MIGRATIONS

  for patch in \
    "${HP_BASE_DIR}/backend/sql/PATCH_LOCAL_MISSING_OBJECTS.sql" \
    "${HP_BASE_DIR}/backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql" \
    "${HP_BASE_DIR}/backend/sql/FIX_SYNC_SCORING.sql" \
    "${HP_BASE_DIR}/backend/sql/14_ADD_INTERFERENCE_CALLS.sql" \
    "${HP_BASE_DIR}/backend/sql/UPGRADE_SYNC_SCHEMA_20260417.sql" \
    "${HP_BASE_DIR}/backend/sql/UPGRADE_LOCAL_HEAT_WORKFLOW_20260418.sql"
  do
    if [ -f "\$patch" ]; then
      mark_sql_applied "\$(basename "\$patch")"
    fi
  done
}

seed_tracking_if_runtime_is_current

# Function to run an SQL script if it hasn't been applied yet
apply_sql_if_needed() {
  local sql_path="\$1"
  local base_name=\$(basename "\$sql_path")

  if [ ! -f "\$sql_path" ]; then
    echo "⚠️  File not found: \$sql_path, skipping."
    return
  fi

  # Check if migration has already been applied
  local is_applied=\$(psql_scalar "
    SELECT EXISTS (SELECT 1 FROM public._local_applied_migrations WHERE filename = '\$base_name');
  ")

  if [ "\$is_applied" = "t" ]; then
    echo "  [⏭️ Skipped] \$base_name"
  else
    echo "  [🚀 Applying] \$base_name..."
    docker exec -i surfjudging_postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "\$sql_path"
    mark_sql_applied "\$base_name"
  fi
}

echo "==> Checking and applying baseline patches..."
for patch in \
  "${HP_BASE_DIR}/backend/sql/PATCH_LOCAL_MISSING_OBJECTS.sql" \
  "${HP_BASE_DIR}/backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql" \
  "${HP_BASE_DIR}/backend/sql/FIX_SYNC_SCORING.sql" \
  "${HP_BASE_DIR}/backend/sql/14_ADD_INTERFERENCE_CALLS.sql" \
  "${HP_BASE_DIR}/backend/sql/UPGRADE_SYNC_SCHEMA_20260417.sql" \
  "${HP_BASE_DIR}/backend/sql/UPGRADE_LOCAL_HEAT_WORKFLOW_20260418.sql"
do
  apply_sql_if_needed "\$patch"
done

echo "==> Checking and applying migrations alphabetically..."
# Find all SQL migrations, sort them alphabetically to ensure correct order
migrations=\$(find "${HP_BASE_DIR}/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "TEST_MIGRATIONS.sql" | sort)

for migration in \$migrations; do
  apply_sql_if_needed "\$migration"
done

echo "==> Verifying migration tracker..."
latest_migration=\$(find "${HP_BASE_DIR}/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "TEST_MIGRATIONS.sql" | sort | tail -n 1)
latest_base=\$(basename "\$latest_migration")
tracked_latest=\$(psql_scalar "SELECT max(filename) FROM public._local_applied_migrations WHERE filename ~ '^[0-9]' AND filename <> 'TEST_MIGRATIONS.sql';")

if [ "\$tracked_latest" != "\$latest_base" ]; then
  echo "❌ Latest migration mismatch. Expected \$latest_base, tracked \$tracked_latest" >&2
  exit 1
fi

missing_count=0
while IFS= read -r migration; do
  [ -n "\$migration" ] || continue
  base_name=\$(basename "\$migration")
  is_applied=\$(psql_scalar "SELECT EXISTS (SELECT 1 FROM public._local_applied_migrations WHERE filename = '\$base_name');")
  if [ "\$is_applied" != "t" ]; then
    echo "❌ Missing migration tracking: \$base_name" >&2
    missing_count=\$((missing_count + 1))
  fi
done <<MIGRATIONS
\$migrations
MIGRATIONS

if [ "\$missing_count" -gt 0 ]; then
  exit 1
fi

echo "==> Migration tracker OK: latest \$tracked_latest"

docker compose -f docker-compose-local.yml restart rest kong >/dev/null 2>&1 || true
docker compose -f docker-compose-local.yml ps
EOF

echo "==> HP stack refresh completed"
