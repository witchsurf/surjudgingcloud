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

state_dir="${SURFJUDGING_STATE_DIR:-$HOME/Library/Application Support/SurfJudging/runtime}"
compose_dir="$state_dir/compose"
echo "FIELD_STAGE staging-config $compose_dir"
mkdir -p "$compose_dir"
chmod 700 "$state_dir" "$compose_dir"
if [[ ! -f "$compose_dir/.env" ]]; then
  cp "$root/compose/.env" "$compose_dir/.env"
  chmod 600 "$compose_dir/.env"
fi
cp "$root/compose/compose.yaml" "$compose_dir/compose.yaml.next"
mv "$compose_dir/compose.yaml.next" "$compose_dir/compose.yaml"
cp "$root/compose/kong.yml" "$compose_dir/kong.yml.next"
mv "$compose_dir/kong.yml.next" "$compose_dir/kong.yml"

total="$(wc -l < "$root/images/load-plan.tsv" | tr -d ' ')"
current=0
while IFS=$'\t' read -r archive image; do
  [[ -z "$archive" || -z "$image" ]] && continue
  current=$((current + 1))
  if "$docker_bin" image inspect "$image" >/dev/null 2>&1; then
    echo "FIELD_STAGE image-ready $current/$total $image"
  else
    echo "FIELD_STAGE image-load $current/$total $image"
    "$docker_bin" load -i "$root/images/$archive" >/dev/null
  fi
done < "$root/images/load-plan.tsv"

echo "FIELD_STAGE kong-config"
kong_config_volume="surfjudging_field_kong_config"
kong_config_seed="surfjudging_field_kong_config_seed"
"$docker_bin" rm -f "$kong_config_seed" >/dev/null 2>&1 || true
"$docker_bin" volume create "$kong_config_volume" >/dev/null
"$docker_bin" create --name "$kong_config_seed" -v "$kong_config_volume:/var/lib/kong" kong:2.8.1 true >/dev/null
"$docker_bin" cp "$root/compose/kong.yml" "$kong_config_seed:/var/lib/kong/kong.yml"
"$docker_bin" rm "$kong_config_seed" >/dev/null

echo "FIELD_STAGE compose-start"
"$docker_bin" compose --project-name surfjudging-field --env-file "$compose_dir/.env" -f "$compose_dir/compose.yaml" up -d
echo "FIELD_STAGE compose-finished"
