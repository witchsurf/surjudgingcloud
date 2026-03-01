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

# The containers will be stopped later, right before restarting, to minimize downtime.
echo "🔨 Building frontend..."
cd frontend
rm -rf dist node_modules/.vite
# Ensure dependencies match lockfile before building
npm ci
npm run build

# Rebuild and restart containers
echo "🐳 Rebuilding and starting containers..."
cd ../infra
# Ensure ACME storage remains secure across deploys (Traefik requires 600)
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json || true
chown root:root letsencrypt/acme.json || true

echo "⏸️  Stopping old containers..."
docker compose down

echo "🚀 Starting new containers with forced rebuild..."
docker compose up -d --build

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
