#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible alias kept for old operator habits.
# New preferred entrypoint:
#   ./scripts/hp-ops.sh upgrade --field
#   ./scripts/hp-ops.sh upgrade --home

PROFILE="field"
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --field)
      PROFILE="field"
      ;;
    --home)
      PROFILE="home"
      ;;
    --full-stack)
      # upgrade refreshes the stack by default.
      ;;
    --skip-deploy|--skip-healthcheck|--host)
      ARGS+=("$1")
      if [[ "$1" == "--host" ]]; then
        ARGS+=("$2")
        shift
      fi
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/field-ops.sh [--field|--home] [--skip-deploy] [--skip-healthcheck]

Compatibility wrapper around:
  ./scripts/hp-ops.sh upgrade --field
  ./scripts/hp-ops.sh upgrade --home
EOF
      exit 0
      ;;
    *)
      ARGS+=("$1")
      ;;
  esac
  shift
done

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hp-ops.sh" upgrade "--$PROFILE" "${ARGS[@]}"
