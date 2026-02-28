#!/bin/bash
# Run this script AS ROOT on your VPS to fix the deployment setup

echo "🔧 Fixing VPS deployment setup..."
echo "================================"

cd /opt/judging

# Backup old deploy.sh
echo "📦 Backing up old deploy.sh..."
cp deploy.sh deploy.sh.old.backup

# Create the correct deploy.sh
echo "✍️ Creating correct deploy.sh..."
cat > deploy.sh << 'DEPLOY_EOF'
#!/bin/bash
set -e

# Deployment script for surfjudging.cloud
# This script runs on the VPS to deploy the latest changes

echo "🚀 Starting deployment..."
echo "================================"

# Navigate to project directory
cd /opt/judging

# Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git fetch origin
git reset --hard origin/main

# Stop containers
echo "⏸️  Stopping containers..."
cd infra
docker compose down

# Rebuild frontend
echo "🔨 Building frontend..."
cd ../frontend
rm -rf dist node_modules/.vite
npm run build

# Rebuild and restart containers
echo "🐳 Rebuilding and starting containers..."
cd ../infra
docker compose build --no-cache surfjudging
docker compose up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 10

# Check status
echo "✅ Deployment complete!"
echo "================================"
echo "📊 Container status:"
docker compose ps

echo ""
echo "🔍 Recent Traefik logs:"
docker compose logs --tail=20 traefik

echo ""
echo "✅ Deployment finished successfully!"
echo "🌐 Site: https://surfjudging.cloud"
DEPLOY_EOF

# Make it executable
chmod +x deploy.sh

echo "✅ deploy.sh fixed!"
echo ""
echo "📝 Verifying..."
ls -lh deploy.sh
echo ""
echo "🎉 VPS deployment setup is now correct!"
echo "You can now trigger deployments from GitHub Actions."
