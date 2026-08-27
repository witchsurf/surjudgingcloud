#!/usr/bin/env bash
set -euo pipefail

root=/docker-entrypoint-initdb.d/surfjudging-field
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$root/baseline.sql"
for migration in "$root"/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$migration"
done
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$root/field-mode.sql"
