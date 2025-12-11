#!/bin/bash
set -euo pipefail

LOCAL_DIR="$HOME/Desktop/judging"
REMOTE_USER="root"
REMOTE_HOST="srv1074268"
REMOTE_DIR="/opt/judging"

echo "👀 Watching $LOCAL_DIR for changes..."

sync_once() {
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --info=stats2,progress2 \
    "$LOCAL_DIR"/ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"
}

sync_once  # initial sync

fswatch -o "$LOCAL_DIR" | while read -r _; do
  echo "🔄 Syncing..."
  if sync_once; then
    echo "✅ Done."
  else
    echo "❌ Sync failed; retrying in 5s..." >&2
    sleep 5
  fi
done
