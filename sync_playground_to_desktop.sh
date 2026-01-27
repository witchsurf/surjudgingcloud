#!/bin/bash
set -euo pipefail

PLAYGROUND_DIR="/Users/laraise/.gemini/antigravity/playground/neon-planck"
DESKTOP_DIR="$HOME/Desktop/judging"

echo "🔄 Syncing Playground → Desktop/judging..."

rsync -av --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  "$PLAYGROUND_DIR"/ "$DESKTOP_DIR"/

echo "✅ Sync complete!"
echo "📂 Files updated in: $DESKTOP_DIR"
