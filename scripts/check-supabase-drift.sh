#!/usr/bin/env bash
set -euo pipefail

# Check drift between canonical and mirror Supabase function trees.
# Canonical source: backend/supabase/functions
# Mirror target:    supabase/functions

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/backend/supabase/functions"
DST_DIR="$ROOT_DIR/supabase/functions"

if [[ ! -d "$SRC_DIR" || ! -d "$DST_DIR" ]]; then
  echo "Missing directory."
  echo "  source: $SRC_DIR"
  echo "  target: $DST_DIR"
  exit 1
fi

status=0

echo "Checking drift:"
echo "  source: $SRC_DIR"
echo "  target: $DST_DIR"
echo

while IFS= read -r -d '' src_file; do
  rel="${src_file#"$SRC_DIR"/}"
  dst_file="$DST_DIR/$rel"

  if [[ ! -f "$dst_file" ]]; then
    echo "MISSING in target: $rel"
    status=1
    continue
  fi

  if ! cmp -s "$src_file" "$dst_file"; then
    echo "DIFF: $rel"
    status=1
  fi
done < <(find "$SRC_DIR" -type f -print0 | sort -z)

while IFS= read -r -d '' dst_file; do
  rel="${dst_file#"$DST_DIR"/}"
  src_file="$SRC_DIR/$rel"
  if [[ ! -f "$src_file" ]]; then
    echo "EXTRA in target (not in source): $rel"
  fi
done < <(find "$DST_DIR" -type f -print0 | sort -z)

echo
if [[ "$status" -eq 0 ]]; then
  echo "No drift detected for shared files."
else
  echo "Drift detected."
fi

exit "$status"
