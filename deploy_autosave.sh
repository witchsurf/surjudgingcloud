#!/bin/bash
set -e

echo "🚀 Déploiement VPS - Auto-Save Config Fix"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📦 Étape 1/4: Sync Desktop → VPS${NC}"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  ~/Desktop/judging/frontend/ \
  root@195.35.2.170:/opt/judging/frontend/

echo ""
echo -e "${BLUE}🔨 Étape 2/4: Build sur VPS${NC}"
ssh root@195.35.2.170 << 'ENDSSH'
  cd /opt/judging/frontend
  echo "→ Cleaning old build..."
  rm -rf dist node_modules/.vite
  
  echo "→ Building production bundle..."
  NODE_ENV=production npm run build
  
  echo "→ Verifying bundle..."
  grep -a "xwaymumbkmwxqifihuvn" dist/assets/*.js | head -1
  grep -a "Config auto-saved" dist/assets/*.js | head -1 || echo "⚠️ Auto-save code might be minified"
ENDSSH

echo ""
echo -e "${BLUE}🔄 Étape 3/4: Restart frontend${NC}"
ssh root@195.35.2.170 << 'ENDSSH'
  cd /opt/judging
  if [ -f docker-compose.yml ]; then
    docker-compose restart frontend
    echo "✅ Docker frontend restarted"
  elif command -v pm2 &> /dev/null; then
    pm2 restart frontend
    echo "✅ PM2 frontend restarted"
  else
    echo "⚠️ No docker-compose or PM2 found, manual restart needed"
  fi
ENDSSH

echo ""
echo -e "${GREEN}✅ Étape 4/4: Déploiement terminé !${NC}"
echo ""
echo "📋 Prochaines étapes:"
echo "  1. Ouvrir https://surfjudging.cloud/my-events"
echo "  2. Se connecter avec email"
echo "  3. Cliquer 'Continuer' sur un événement"
echo "  4. Vérifier console: '📝 No config snapshot found...' → '✅ Config auto-saved'"
echo "  5. Admin doit afficher: DB=YES!"
echo "  6. Tester lien kiosk"
echo ""
