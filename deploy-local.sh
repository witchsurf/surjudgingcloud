#!/bin/bash

# Local Deployment Script
# Use this to deploy from your local machine to the VPS

set -e  # Exit on error

# VPS Configuration
VPS_HOST="195.35.2.170"  # Production VPS public IP
VPS_USER="sandy"  # SSH username on the VPS
DEPLOY_DIR="/opt/judging"

echo "🚀 Deploying to VPS at ${VPS_HOST}..."
echo ""

# Check if we can reach the VPS
if ! ping -c 1 ${VPS_HOST} &> /dev/null; then
    echo "❌ Cannot reach VPS at ${VPS_HOST}"
    exit 1
fi

echo "✅ VPS is reachable"
echo ""

# Push to GitHub first
echo "📤 Pushing to GitHub..."
git push origin main
echo "✅ Pushed to GitHub"
echo ""

# SSH into VPS and deploy
echo "🔧 Deploying on VPS..."
ssh ${VPS_USER}@${VPS_HOST} << 'ENDSSH'
    cd /opt/judging

    echo "📥 Pulling latest code..."
    git pull origin main

    echo "🔧 Running deployment script..."
    chmod +x deploy.sh
    ./deploy.sh

    echo "✅ Deployment complete!"
ENDSSH

echo ""
echo "🎉 Deployment finished successfully!"
echo "🌐 Visit: http://surfjudging.local:5173"
