#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID="${1:?missing release id}"
EXPECTED_SHA256="${2:?missing sha256}"
ARCHIVE_PATH="${3:?missing archive path}"

RELEASES_ROOT=/opt/surfjudging-test/releases
CURRENT_LINK=/opt/surfjudging-test/current
CONTAINER_NAME=surfjudging-test
PRODUCTION_CONTAINER=surfjudging

[[ "$RELEASE_ID" =~ ^surfjudging-[A-Za-z0-9._-]+$ ]]
[[ "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]]
test -f "$ARCHIVE_PATH"

ACTUAL_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
test "$ACTUAL_SHA256" = "$EXPECTED_SHA256"

mkdir -p "$RELEASES_ROOT"
RELEASE_DIR="$RELEASES_ROOT/$RELEASE_ID"
if [[ ! -e "$RELEASE_DIR" ]]; then
  STAGING_DIR="$RELEASES_ROOT/.${RELEASE_ID}.tmp.$$"
  mkdir "$STAGING_DIR"
  trap 'rm -rf "$STAGING_DIR"' EXIT
  tar -xzf "$ARCHIVE_PATH" -C "$STAGING_DIR"
  test -f "$STAGING_DIR/dist/index.html"
  test -f "$STAGING_DIR/dist/deployment-manifest.json"
  grep -Eq '"deploymentMode"[[:space:]]*:[[:space:]]*"cloud"' "$STAGING_DIR/dist/deployment-manifest.json"
  printf '%s\n' "$EXPECTED_SHA256" > "$STAGING_DIR/ARCHIVE_SHA256"
  printf '%s\n' "$RELEASE_ID" > "$STAGING_DIR/dist/RELEASE_ID"
  mv "$STAGING_DIR" "$RELEASE_DIR"
  trap - EXIT
else
  test "$(tr -d '\r\n' < "$RELEASE_DIR/ARCHIVE_SHA256")" = "$EXPECTED_SHA256"
fi

PREVIOUS_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_TARGET="$(readlink "$CURRENT_LINK")"
fi
NEXT_LINK="${CURRENT_LINK}.next.$$"
ln -s "$RELEASE_DIR" "$NEXT_LINK"
python3 -c 'import os,sys; os.replace(sys.argv[1],sys.argv[2])' "$NEXT_LINK" "$CURRENT_LINK"

IMAGE="$(docker inspect --format '{{.Config.Image}}' "$PRODUCTION_CONTAINER")"
NETWORK="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$PRODUCTION_CONTAINER")"
test -n "$IMAGE"
test -n "$NETWORK"

rollback() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    local rollback_link="${CURRENT_LINK}.rollback.$$"
    ln -s "$PREVIOUS_TARGET" "$rollback_link"
    python3 -c 'import os,sys; os.replace(sys.argv[1],sys.argv[2])' "$rollback_link" "$CURRENT_LINK"
  fi
}

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
if ! docker run -d \
  --name "$CONTAINER_NAME" \
  --restart always \
  --network "$NETWORK" \
  --label 'traefik.enable=true' \
  --label 'traefik.http.routers.surfjudging-test.entrypoints=websecure' \
  --label 'traefik.http.routers.surfjudging-test.rule=Host(`test.surfjudging.cloud`)' \
  --label 'traefik.http.routers.surfjudging-test.tls=true' \
  --label 'traefik.http.routers.surfjudging-test.tls.certresolver=le' \
  --label 'traefik.http.services.surfjudging-test.loadbalancer.server.port=80' \
  --mount "type=bind,src=$CURRENT_LINK/dist,dst=/usr/share/nginx/html,readonly" \
  "$IMAGE" >/dev/null; then
  rollback
  exit 5
fi

echo "TEST_RELEASE_ID=$RELEASE_ID"
echo "TEST_ARCHIVE_SHA256=$ACTUAL_SHA256"
echo "TEST_CURRENT=$(readlink "$CURRENT_LINK")"
echo "PRODUCTION_CONTAINER_UNCHANGED=$(docker inspect --format '{{.Name}}' "$PRODUCTION_CONTAINER")"
