#!/bin/bash

echo "🚀 Sync clean vers VPS..."

# Sync SEULEMENT les fichiers sources, dist, et config
rsync -avz \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.next' \
  --exclude '.cache' \
  --exclude 'dist' \
  --exclude '.env.local' \
  /Users/laraise/Desktop/judging/frontend/src/ \
  root@195.35.2.170:/opt/judging/frontend/src/

echo "✅ Sources syncées!"
echo ""
echo "Maintenant sur VPS:"
echo "  cd /opt/judging/frontend && npm run build"
echo "  cd /opt/judging/infra && docker compose down && docker compose up -d --build"
