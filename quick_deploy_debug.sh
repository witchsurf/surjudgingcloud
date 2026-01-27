#!/bin/bash

echo "🚀 Quick Deploy to VPS avec logs debug..."

# 1. Build local (déjà fait)
echo "✅ Build local OK"

# 2. Sync vers VPS
echo "📤 Syncing vers VPS..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  /Users/laraise/Desktop/judging/ \
  root@195.35.2.170:/opt/judging/

# 3. Rebuild Docker sur VPS
echo "🐳 Rebuild Docker sur V PS..."
ssh root@195.35.2.170 << 'EOF'
cd /opt/judging/infra
docker compose down
docker compose up -d --build
echo "✅ Frontend redémarré"
EOF

echo ""
echo "✅ DEPLOY TERMINÉ !"
echo ""
echo "🔍 MAINTENANT:"
echo "1. Va sur https://surfjudging.cloud/admin"
echo "2. Ouvre console navigateur"
echo "3. Start timer"
echo "4. Cherche log '❌ ERREUR SUPABASE'"
echo "5. Screenshot et envoie-moi l'erreur exacte !"
echo ""
