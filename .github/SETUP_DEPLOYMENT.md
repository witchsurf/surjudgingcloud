# Automated Deployment Setup

This guide explains how to set up automated deployment from GitHub to your VPS.

## Overview

When you push code to the `main` branch, GitHub Actions will automatically:
1. SSH into your VPS
2. Pull the latest code
3. Rebuild the frontend
4. Restart Docker containers
5. Verify deployment

## Quick Setup

### 1. Generate SSH Key for GitHub Actions

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_actions_vps -C "github-actions@surfjudging.cloud"
```

### 2. Add Public Key to VPS

```bash
cat ~/.ssh/github_actions_vps.pub | ssh root@195.35.2.170 "cat >> ~/.ssh/authorized_keys"
```

### 3. Add Secrets to GitHub

Go to: https://github.com/witchsurf/surjudgingcloud/settings/secrets/actions

Add these secrets:
- `VPS_HOST` = `195.35.2.170`
- `VPS_USER` = `root`
- `VPS_SSH_KEY` = contents of `~/.ssh/github_actions_vps` (the private key)

### 4. Copy deploy.sh to VPS

```bash
scp deploy.sh root@195.35.2.170:/opt/judging/
```

### 5. Push and Test

```bash
git add .github/ deploy.sh
git commit -m "feat: add automated deployment"
git push origin main
```

Check: https://github.com/witchsurf/surjudgingcloud/actions

## Manual Deployment

You can also run the deployment script manually on the VPS:

```bash
ssh root@195.35.2.170
cd /opt/judging
./deploy.sh
```

## Troubleshooting

### Test SSH Connection
```bash
ssh -i ~/.ssh/github_actions_vps root@195.35.2.170
```

### View Deployment Logs
https://github.com/witchsurf/surjudgingcloud/actions

### Check VPS Status
```bash
ssh root@195.35.2.170
cd /opt/judging/infra
docker compose ps
docker compose logs
```

## Rollback

```bash
ssh root@195.35.2.170
cd /opt/judging
git log --oneline  # Find good commit
git reset --hard <commit-hash>
./deploy.sh
```
