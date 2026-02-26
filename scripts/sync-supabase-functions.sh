#!/usr/bin/env bash
set -euo pipefail

# Sync Edge Functions from canonical source to legacy mirror.
# Canonical source: backend/supabase/functions
# Mirror target:    supabase/functions

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/backend/supabase/functions"
DST_DIR="$ROOT_DIR/supabase/functions"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Source directory not found: $SRC_DIR"
  exit 1
fi

mkdir -p "$DST_DIR"

echo "Syncing Supabase functions"
echo "  from: $SRC_DIR"
echo "    to: $DST_DIR"

# Non-destructive sync by default to avoid accidental function removal.
rsync -a "$SRC_DIR/" "$DST_DIR/"

echo "Sync complete."
echo "Tip: run scripts/check-supabase-drift.sh to verify consistency."
