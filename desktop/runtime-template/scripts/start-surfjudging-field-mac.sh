#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
for archive in "$root"/images/*.tar; do
  docker load -i "$archive" >/dev/null
done
docker compose --project-name surfjudging-field --env-file "$root/compose/.env" -f "$root/compose/compose.yaml" up -d
