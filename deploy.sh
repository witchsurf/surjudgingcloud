#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID="${1:-}"
EXPECTED_SHA256="${2:-}"
ARCHIVE_PATH="${3:-}"

RELEASES_ROOT="${SURFJUDGING_RELEASES_ROOT:-/opt/surfjudging/releases}"
CURRENT_LINK="${SURFJUDGING_CURRENT_LINK:-/opt/surfjudging/current}"
APP_DIR="${SURFJUDGING_APP_DIR:-/opt/judging}"
CONTAINER_NAME="${SURFJUDGING_WEB_CONTAINER:-surfjudging}"
HEALTH_URL="${SURFJUDGING_HEALTH_URL:-http://127.0.0.1:8080/admin}"

if [[ ! "$RELEASE_ID" =~ ^surfjudging-[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid or missing RELEASE_ID" >&2
  exit 2
fi
if [[ ! "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Invalid or missing SHA-256" >&2
  exit 2
fi
if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Archive not found: $ARCHIVE_PATH" >&2
  exit 2
fi

ACTUAL_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Archive SHA-256 mismatch" >&2
  exit 3
fi

mkdir -p "$RELEASES_ROOT" "$(dirname "$CURRENT_LINK")"
RELEASE_DIR="$RELEASES_ROOT/$RELEASE_ID"

if [[ -e "$RELEASE_DIR" ]]; then
  if [[ ! -f "$RELEASE_DIR/ARCHIVE_SHA256" ]] || \
     [[ "$(tr -d '\n' < "$RELEASE_DIR/ARCHIVE_SHA256")" != "$EXPECTED_SHA256" ]]; then
    echo "Existing release directory has a different or missing checksum" >&2
    exit 4
  fi
else
  STAGING_DIR="$RELEASES_ROOT/.${RELEASE_ID}.tmp.$$"
  mkdir "$STAGING_DIR"
  trap 'rm -rf "$STAGING_DIR"' EXIT
  tar -xzf "$ARCHIVE_PATH" -C "$STAGING_DIR"

  test -f "$STAGING_DIR/dist/index.html"
  test -f "$STAGING_DIR/dist/sw.js"
  find "$STAGING_DIR/dist/assets" -maxdepth 1 -type f -name 'xlsxParser-*.js' -print -quit | grep -q .

  printf '%s\n' "$EXPECTED_SHA256" > "$STAGING_DIR/ARCHIVE_SHA256"
  printf '%s\n' "$RELEASE_ID" > "$STAGING_DIR/RELEASE_ID"
  printf '%s\n' "$RELEASE_ID" > "$STAGING_DIR/dist/RELEASE_ID"
  mv "$STAGING_DIR" "$RELEASE_DIR"
  trap - EXIT
fi

PREVIOUS_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_TARGET="$(readlink "$CURRENT_LINK")"
elif docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  LEGACY_ID="legacy-$(date -u +%Y%m%dT%H%M%SZ)"
  LEGACY_DIR="$RELEASES_ROOT/$LEGACY_ID"
  mkdir -p "$LEGACY_DIR/dist"
  docker cp "$CONTAINER_NAME:/usr/share/nginx/html/." "$LEGACY_DIR/dist/"
  printf '%s\n' "$LEGACY_ID" > "$LEGACY_DIR/RELEASE_ID"
  PREVIOUS_TARGET="$LEGACY_DIR"
fi

NEXT_LINK="${CURRENT_LINK}.next.$$"
ln -s "$RELEASE_DIR" "$NEXT_LINK"
python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$NEXT_LINK" "$CURRENT_LINK"

rollback() {
  if [[ -n "$PREVIOUS_TARGET" && -e "$PREVIOUS_TARGET" ]]; then
    local rollback_link="${CURRENT_LINK}.rollback.$$"
    ln -s "$PREVIOUS_TARGET" "$rollback_link"
    python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$rollback_link" "$CURRENT_LINK"
    cd "$APP_DIR/infra"
    SURFJUDGING_CURRENT_DIR="$CURRENT_LINK" docker compose up -d --no-build --no-deps --force-recreate surfjudging
  fi
}

cd "$APP_DIR/infra"
if ! SURFJUDGING_CURRENT_DIR="$CURRENT_LINK" docker compose up -d --no-build --no-deps --force-recreate surfjudging; then
  rollback
  exit 5
fi

if ! curl -fsS --retry 10 --retry-delay 2 --retry-connrefused --retry-all-errors "$HEALTH_URL" >/dev/null; then
  rollback
  echo "Frontend health check failed; previous release restored" >&2
  exit 6
fi

SERVED_RELEASE="$(curl -fsS "${HEALTH_URL%/admin}/RELEASE_ID" | tr -d '\r\n')"
if [[ "$SERVED_RELEASE" != "$RELEASE_ID" ]]; then
  rollback
  echo "Served RELEASE_ID mismatch; previous release restored" >&2
  exit 7
fi

echo "Immutable frontend deployed"
echo "RELEASE_ID=$RELEASE_ID"
echo "ARCHIVE_SHA256=$ACTUAL_SHA256"
echo "CURRENT=$(readlink "$CURRENT_LINK")"
if [[ -n "$PREVIOUS_TARGET" ]]; then
  echo "ROLLBACK_TARGET=$PREVIOUS_TARGET"
fi
