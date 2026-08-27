#!/usr/bin/env bash
set -euo pipefail

expected='__SURFJUDGING_SCHEMA_VERSION__'
actual="$(psql -U postgres -d postgres -Atc \
  "select schema_version from public.app_runtime_schema_version where id = true" \
  2>/dev/null || true)"

[[ "$actual" == "$expected" ]]
