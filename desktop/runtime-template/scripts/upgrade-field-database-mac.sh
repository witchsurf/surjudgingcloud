#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
docker_bin="${SURFJUDGING_DOCKER_BIN:-docker}"
container="${SURFJUDGING_POSTGRES_CONTAINER:-surfjudging_field_postgres}"
migration_dir="$root/database/migrations"
target="$(tr -d '\r\n' < "$root/database/expected-schema.txt")"

if ! "$docker_bin" container inspect "$container" >/dev/null 2>&1; then
  echo "FIELD_STAGE database-upgrade-not-required fresh-runtime"
  exit 0
fi

if [[ "$("$docker_bin" inspect -f '{{.State.Running}}' "$container")" != "true" ]]; then
  "$docker_bin" start "$container" >/dev/null
fi

for _ in $(seq 1 60); do
  if "$docker_bin" exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
"$docker_bin" exec "$container" pg_isready -U postgres -d postgres >/dev/null

current="$("$docker_bin" exec "$container" psql -U postgres -d postgres -Atc \
  "select schema_version from public.app_runtime_schema_version where id = true")"
if [[ "$current" == "$target" ]]; then
  echo "FIELD_STAGE database-schema-ready $target"
  exit 0
fi

found_current=0
applied=0
for migration in "$migration_dir"/*.sql; do
  schema="$(basename "$migration" .sql)"
  if [[ "$schema" == "$current" ]]; then
    found_current=1
    continue
  fi
  if [[ "$found_current" -eq 0 ]]; then continue; fi
  echo "FIELD_STAGE database-migration $schema"
  "$docker_bin" exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration"
  observed="$("$docker_bin" exec "$container" psql -U postgres -d postgres -Atc \
    "select schema_version from public.app_runtime_schema_version where id = true")"
  if [[ "$observed" != "$schema" ]]; then
    echo "Migration $schema did not publish its schema marker (observed: $observed)." >&2
    exit 31
  fi
  applied=$((applied + 1))
  if [[ "$schema" == "$target" ]]; then break; fi
done

if [[ "$found_current" -ne 1 ]]; then
  echo "Unsupported Field schema upgrade source: $current" >&2
  exit 32
fi
final="$("$docker_bin" exec "$container" psql -U postgres -d postgres -Atc \
  "select schema_version from public.app_runtime_schema_version where id = true")"
if [[ "$final" != "$target" ]]; then
  echo "Incomplete Field schema upgrade: expected $target, observed $final" >&2
  exit 33
fi
echo "FIELD_STAGE database-upgrade-complete $applied $target"
