# 🚀 Deployment Setup Guide

## Your Current Setup

You have **TWO separate environments**:

### 1. 🌐 **VPS (Production Server)** - Online
   - **Purpose**: Production deployment, accessible from internet
   - **Needs**: Public IP or domain name
   - **GitHub Actions**: Can deploy here via SSH

### 2. 💻 **Local VM (Development)** - Offline
   - **IP**: 192.168.1.78 (local network only)
   - **Purpose**: Local development with Docker/Supabase
   - **Dev Mode**: VITE_DEV_MODE=true
   - **GitHub Actions**: Cannot reach this (local network)

---

## 🎯 Deployment Strategy

```
┌─────────────────────────────────────────────────────┐
│  LOCAL DEVELOPMENT (VM - 192.168.1.78)              │
│  • Run: npm run dev                                  │
│  • Dev mode enabled (VITE_DEV_MODE=true)            │
│  • Local Supabase via Docker                         │
│  • Test features offline                             │
└─────────────────────────────────────────────────────┘
                      ↓
              git push origin main
                      ↓
┌─────────────────────────────────────────────────────┐
│  GITHUB                                              │
│  • Code repository                                   │
│  • GitHub Actions triggered                          │
└─────────────────────────────────────────────────────┘
                      ↓
              SSH Deploy (Auto)
                      ↓
┌─────────────────────────────────────────────────────┐
│  VPS PRODUCTION (Public IP/Domain)                   │
│  • Production Supabase (Cloud)                       │
│  • Dev mode disabled (VITE_DEV_MODE=false)          │
│  • Public access: https://surfjudging.cloud          │
│  • Payment & magic links work                        │
└─────────────────────────────────────────────────────┘
```

---

## 📋 Setup Checklist

### ✅ Step 1: Get Your VPS Public IP/Domain

**Option A: If you have a domain:**
```
surfjudging.cloud
```

**Option B: Get VPS public IP:**

SSH to your VPS and run:
```bash
curl ifconfig.me
# Example output: 203.0.113.45
```

Or check your VPS provider's dashboard.

### ✅ Step 2: Update GitHub Secrets

1. **Go to GitHub Secrets:**
   ```
   https://github.com/witchsurf/surjudgingcloud/settings/secrets/actions
   ```

2. **Update these secrets:**

   | Secret Name | Value | Example |
   |------------|-------|---------|
   | `VPS_HOST` | Your VPS public IP or domain | `203.0.113.45` or `surfjudging.cloud` |
   | `VPS_USER` | SSH username on VPS | `sandy` or `root` |
   | `VPS_SSH_KEY` | Private SSH key for VPS | `-----BEGIN RSA PRIVATE KEY-----...` |

### ✅ Step 3: Configure VPS Environment

SSH to your VPS:
```bash
ssh your-user@your-vps-ip
```

Then create/update `.env` for **production**:
```bash
# On VPS: /opt/judging/frontend/.env.production
VITE_DEV_MODE=false  # IMPORTANT: Disable dev mode in production

# Production Supabase (Cloud)
VITE_SUPABASE_URL=https://xwaymumbkmwxqifihuvn.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Production site URL
VITE_SITE_URL=https://surfjudging.cloud  # Or your VPS public URL
```

### ✅ Step 4: Re-enable GitHub Actions Workflow

```bash
cd /Users/sandy/Desktop/judging

# Re-enable the SSH workflow
mv .github/workflows/deploy.yml.disabled .github/workflows/deploy.yml

# Commit and push
git add .github/workflows/
git commit -m "chore: re-enable SSH workflow with correct VPS configuration"
git push origin main
```

---

## 🔑 SSH Key Setup (If Needed)

If you don't have an SSH key for your VPS:

### 1. Generate SSH Key Pair
```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/vps_deploy

# This creates:
# - ~/.ssh/vps_deploy (private key - add to GitHub Secret)
# - ~/.ssh/vps_deploy.pub (public key - add to VPS)
```

### 2. Add Public Key to VPS
```bash
# Copy the public key
cat ~/.ssh/vps_deploy.pub

# SSH to VPS and add it
ssh your-user@your-vps-ip
mkdir -p ~/.ssh
echo "paste-your-public-key-here" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. Add Private Key to GitHub Secret
```bash
# Copy the private key
cat ~/.ssh/vps_deploy

# Then:
# 1. Go to: https://github.com/witchsurf/surjudgingcloud/settings/secrets/actions
# 2. Create/Update VPS_SSH_KEY
# 3. Paste the ENTIRE private key (including BEGIN/END lines)
```

---

## 🧪 Testing Deployment

### Test SSH Connection
```bash
# From your local machine
ssh -i ~/.ssh/vps_deploy your-user@your-vps-ip

# Should connect without password
```

### Test Manual Deployment
```bash
# Deploy manually to test
cd /Users/sandy/Desktop/judging
./deploy-local.sh  # But change VPS_HOST to public IP first
```

### Trigger GitHub Actions
```bash
# Make a small change
echo "# Test deployment" >> README.md
git add README.md
git commit -m "test: trigger deployment"
git push origin main

# Watch deployment: https://github.com/witchsurf/surjudgingcloud/actions
```

---

## 📝 Environment File Examples

### Local VM (.env.local) - Development
```env
# Dev mode ENABLED
VITE_DEV_MODE=true
VITE_DEV_USER_EMAIL=dev@surfjudging.local

# Local Supabase (Docker on VM)
VITE_SUPABASE_URL=http://surfjudging.local:8000
VITE_SUPABASE_ANON_KEY=local-vm-key

# Cloud Supabase (for syncing events)
VITE_SUPABASE_URL_CLOUD=https://xwaymumbkmwxqifihuvn.supabase.co
VITE_SUPABASE_ANON_KEY_CLOUD=your-cloud-key
```

### VPS (.env.production) - Production
```env
# Dev mode DISABLED
VITE_DEV_MODE=false

# Production Supabase (Cloud only)
VITE_SUPABASE_URL=https://xwaymumbkmwxqifihuvn.supabase.co
VITE_SUPABASE_ANON_KEY=your-cloud-key

# Public site URL
VITE_SITE_URL=https://surfjudging.cloud
```

---

## 🚨 Common Issues

### Issue: "Connection timeout" in GitHub Actions

**Cause**: VPS_HOST is set to local IP (192.168.1.78) instead of public IP

**Fix**: Update VPS_HOST secret to your VPS public IP or domain

### Issue: "Permission denied (publickey)"

**Cause**: SSH key not properly configured

**Fix**:
1. Verify public key is in VPS ~/.ssh/authorized_keys
2. Verify private key is in GitHub Secret VPS_SSH_KEY
3. Test SSH connection manually first

### Issue: "Host key verification failed"

**Cause**: VPS host key not recognized

**Fix**: Add to workflow (already done):
```yaml
script_stop: false  # Don't stop on warnings
```

Or manually accept host key once:
```bash
ssh-keyscan -H your-vps-ip >> ~/.ssh/known_hosts
```

---

## 🎉 Final Checklist

Before re-enabling workflow:

- [ ] Found VPS public IP or domain
- [ ] Updated GitHub Secret: VPS_HOST
- [ ] Updated GitHub Secret: VPS_USER
- [ ] Updated GitHub Secret: VPS_SSH_KEY
- [ ] Tested SSH connection manually
- [ ] Created .env.production on VPS
- [ ] Re-enabled workflow file
- [ ] Pushed and watched first deployment

---

## 📞 Quick Reference

| Environment | Purpose | Network | Deploy Method |
|------------|---------|---------|---------------|
| **Local VM** | Development | 192.168.1.78 | Manual (npm run dev) |
| **VPS** | Production | Public IP/Domain | GitHub Actions (auto) |

**Local Development:**
```bash
cd /Users/sandy/Desktop/judging/frontend
npm run dev
# Visit: http://192.168.1.78:5173
```

**Deploy to VPS:**
```bash
git push origin main
# GitHub Actions auto-deploys
# Or manual: ./deploy-local.sh (update VPS_HOST first)
```

**Monitor Deployments:**
```
https://github.com/witchsurf/surjudgingcloud/actions
```

---

Need help? Refer back to specific sections above! 🚀
