#!/bin/bash
set -e
echo "🚀 DÉPLOIEMENT VPS - PRODUCTION"
echo "================================"
VPS_IP="195.35.2.170"
VPS_USER="root"
VPS_PATH="/opt/judging"

echo "📤 Upload fichiers..."
scp frontend/src/hooks/useHeatParticipants.ts ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/hooks/
scp frontend/src/hooks/useRealtimeSync.ts ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/hooks/
scp frontend/src/pages/JudgePage.tsx ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/pages/
scp frontend/src/pages/MyEvents.tsx ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/pages/
scp frontend/src/pages/AdminPage.tsx ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/pages/
scp frontend/src/pages/DisplayPage.tsx ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/pages/
scp frontend/src/stores/configStore.ts ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/stores/
scp frontend/src/repositories/EventRepository.ts ${VPS_USER}@${VPS_IP}:${VPS_PATH}/frontend/src/repositories/

echo "✅ Upload OK"
echo ""
echo "🔨 Build sur VPS..."
ssh ${VPS_USER}@${VPS_IP} "cd ${VPS_PATH}/frontend && rm -rf dist node_modules/.vite && npm run build"

echo "✅ Build OK"
echo ""
echo "🐳 Rebuild Docker..."
ssh ${VPS_USER}@${VPS_IP} "cd ${VPS_PATH}/infra && docker compose down && docker compose up -d --build"

echo ""
echo "✅ DÉPLOIEMENT TERMINÉ !"
echo ""
echo "📋 TESTS:"
echo "1. Admin: https://surfjudging.cloud/my-events (DB=YES ?)"
echo "2. Display: https://surfjudging.cloud/display?eventId=6 (noms ?)"
echo "3. Judge incognito: copier lien kiosk"
