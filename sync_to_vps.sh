#!/bin/bash
set -euo pipefail

LOCAL_DIR="$HOME/Desktop/judging"
REMOTE_USER="root"
REMOTE_HOST="195.35.2.170"
REMOTE_DIR="/opt/judging"

echo "👀 Watching $LOCAL_DIR for changes..."

sync_once() {
  rsync -avz --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
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
