#!/bin/bash
set -euo pipefail

echo "🚀 DÉPLOIEMENT AUTOMATIQUE - VPS PRODUCTION"
echo "==========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
FRONTEND_DIR="./frontend"
INFRA_DIR="./infra"

echo -e "${BLUE}📦 Step 1/4: Installing frontend dependencies...${NC}"
cd "$FRONTEND_DIR"
npm ci --prefer-offline --no-audit
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

echo -e "${BLUE}🔨 Step 2/4: Building frontend...${NC}"
rm -rf dist node_modules/.vite
npm run build
echo -e "${GREEN}✅ Frontend built successfully${NC}"
echo ""

echo -e "${BLUE}🐳 Step 3/3: Rebuilding and Restarting Docker containers...${NC}"
cd "../$INFRA_DIR"
echo "⏸️  Stopping old containers..."
docker compose down
echo "🚀 Starting new containers with forced rebuild..."
docker compose up -d --build
echo -e "${GREEN}✅ Containers restarted${NC}"
echo ""

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ DÉPLOIEMENT TERMINÉ !${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📋 TESTS À EFFECTUER:${NC}"
echo "1. Admin: https://surfjudging.cloud/my-events"
echo "2. Display: https://surfjudging.cloud/display"
echo "3. Judge: Tester un lien kiosk"
echo ""
echo -e "${BLUE}📊 Status des containers:${NC}"
docker compose ps
