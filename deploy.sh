#!/bin/bash
set -euo pipefail

PLAYGROUND_DIR="/Users/laraise/.gemini/antigravity/playground/neon-planck"
DESKTOP_DIR="$HOME/Desktop/judging"
REMOTE_USER="root"
REMOTE_HOST="195.35.2.170"
REMOTE_DIR="/opt/judging"

echo "📦 Step 1/2: Syncing Playground → Desktop..."
rsync -av --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'deploy.sh' \
  --exclude 'sync_to_vps.sh' \
  "$PLAYGROUND_DIR"/ "$DESKTOP_DIR"/

echo "✅ Desktop updated!"
echo ""
echo "🚀 Step 2/2: Syncing Desktop → VPS..."
rsync -avz --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  "$DESKTOP_DIR"/ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

echo "✅ Deployment complete!"
