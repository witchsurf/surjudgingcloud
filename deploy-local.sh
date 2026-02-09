#!/bin/bash

# Local Deployment Script
# Use this to deploy from your local machine to the VPS

set -e  # Exit on error

# IMPORTANT: Update these with your VPS details
# VPS_HOST should be your PUBLIC IP or domain, NOT local VM IP
VPS_HOST="YOUR_VPS_PUBLIC_IP_OR_DOMAIN"  # Example: 203.0.113.45 or surfjudging.cloud
VPS_USER="sandy"  # Your SSH username on the VPS
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
