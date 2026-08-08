#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_FILE="$ROOT_DIR/frontend/src/types/supabase.generated.ts"
TEMP_FILE="$(mktemp "${TMPDIR:-/tmp}/surfjudging-supabase-types.XXXXXX")"
EXPECTED_CLI_VERSION="2.111.0"
trap 'rm -f "$TEMP_FILE"' EXIT

ACTUAL_CLI_VERSION="$(supabase --version)"
if [[ "$ACTUAL_CLI_VERSION" != "$EXPECTED_CLI_VERSION" ]]; then
  echo "Supabase CLI $EXPECTED_CLI_VERSION required; found $ACTUAL_CLI_VERSION." >&2
  exit 1
fi

supabase gen types typescript \
  --local \
  --workdir "$ROOT_DIR/backend" \
  --schema public > "$TEMP_FILE"

grep -q '^export type Database = {' "$TEMP_FILE"
grep -q '^[[:space:]]*scores: {' "$TEMP_FILE"
grep -q '^[[:space:]]*upsert_score_secure: {' "$TEMP_FILE"

mv "$TEMP_FILE" "$OUTPUT_FILE"
echo "Generated $OUTPUT_FILE from the isolated local Supabase schema."
