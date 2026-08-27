#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
docker_bin="${SURFJUDGING_DOCKER_BIN:-}"
if [[ -z "$docker_bin" ]]; then
  for candidate in "/Applications/Docker.app/Contents/Resources/bin/docker" "$HOME/.docker/bin/docker" "/usr/local/bin/docker" "/opt/homebrew/bin/docker"; do
    if [[ -x "$candidate" ]]; then docker_bin="$candidate"; break; fi
  done
fi
if [[ -z "$docker_bin" ]]; then docker_bin="$(command -v docker || true)"; fi
if [[ -z "$docker_bin" || ! -x "$docker_bin" ]]; then
  echo "Docker CLI unavailable. Use Prepare this machine in SurfJudging Field." >&2
  exit 20
fi
for archive in "$root"/images/*.tar; do
  "$docker_bin" load -i "$archive" >/dev/null
done
"$docker_bin" compose --project-name surfjudging-field --env-file "$root/compose/.env" -f "$root/compose/compose.yaml" up -d
