# 🏃 Self-Hosted GitHub Runner Setup

## Why Self-Hosted Runner?

Your VPS is on a local network (192.168.1.78), which GitHub Actions can't reach from the internet. A self-hosted runner runs directly on your VPS and can execute deployments locally.

---

## 📋 Setup Instructions

### Step 1: SSH into Your VPS

```bash
ssh sandy@192.168.1.78
# Or however you normally connect
```

### Step 2: Download and Configure GitHub Runner

```bash
# Create a folder for the runner
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download the latest runner (Linux x64)
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz

# Extract it
tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz
```

### Step 3: Get Your Repository Token

1. Go to: **https://github.com/witchsurf/surjudgingcloud/settings/actions/runners/new**
2. You'll see a token that looks like: `ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD`
3. Copy this token (you'll need it in the next step)

### Step 4: Configure the Runner

```bash
# Configure the runner (use the token from step 3)
./config.sh --url https://github.com/witchsurf/surjudgingcloud --token YOUR_TOKEN_HERE

# When prompted:
# - Runner group: Press Enter (default)
# - Runner name: Press Enter (default, usually hostname)
# - Work folder: Press Enter (default _work)
# - Labels: Press Enter (default)
```

### Step 5: Install and Start as Service

```bash
# Install the service (requires sudo)
sudo ./svc.sh install

# Start the service
sudo ./svc.sh start

# Check status
sudo ./svc.sh status
```

---

## ✅ Verify Installation

1. Go to: **https://github.com/witchsurf/surjudgingcloud/settings/actions/runners**
2. You should see your runner with a green "Idle" status

---

## 🔄 Update Workflow

Now switch to the self-hosted workflow:

```bash
cd /opt/judging

# Rename old workflow
mv .github/workflows/deploy.yml .github/workflows/deploy.yml.old

# Activate new workflow
mv .github/workflows/deploy-selfhosted.yml .github/workflows/deploy.yml

# Commit and push
git add .github/workflows/
git commit -m "chore: switch to self-hosted runner for local VPS deployment

- Old SSH-based workflow doesn't work with local IPs
- Self-hosted runner runs directly on VPS
- More reliable and faster deployments

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

git push origin main
```

---

## 🛠️ Managing the Runner

### Check Status
```bash
sudo ~/actions-runner/svc.sh status
```

### Stop Runner
```bash
sudo ~/actions-runner/svc.sh stop
```

### Start Runner
```bash
sudo ~/actions-runner/svc.sh start
```

### View Logs
```bash
# Real-time logs
sudo journalctl -u actions.runner.* -f

# Recent logs
sudo journalctl -u actions.runner.* -n 100
```

### Restart Runner
```bash
sudo ~/actions-runner/svc.sh stop
sudo ~/actions-runner/svc.sh start
```

---

## 🔒 Security Considerations

### 1. Runner Permissions

The runner runs as your user, so limit what it can access:

```bash
# Create dedicated runner user (optional but recommended)
sudo adduser github-runner
sudo usermod -aG docker github-runner  # If using Docker

# Then configure runner with this user
sudo ./svc.sh install github-runner
```

### 2. Secrets Management

Sensitive data (API keys, passwords) should still use GitHub Secrets:

```yaml
- name: Deploy with secrets
  env:
    DATABASE_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: ./deploy.sh
```

### 3. Firewall Rules

Ensure runner has outbound access:

```bash
# Allow outbound HTTPS to GitHub
sudo ufw allow out 443/tcp

# Check current rules
sudo ufw status
```

---

## 🚨 Troubleshooting

### Runner Offline/Not Responding

```bash
# Restart the service
sudo ~/actions-runner/svc.sh restart

# Check if process is running
ps aux | grep Runner.Listener

# Check systemd status
systemctl status actions.runner.*
```

### Deployment Fails

```bash
# Check runner logs
sudo journalctl -u actions.runner.* -n 50

# Check if runner has permissions
ls -la /opt/judging
whoami  # Should be the user that owns /opt/judging
```

### Runner Won't Start

```bash
# Remove old installation
sudo ./svc.sh uninstall

# Reconfigure
./config.sh --url https://github.com/witchsurf/surjudgingcloud --token NEW_TOKEN

# Reinstall service
sudo ./svc.sh install
sudo ./svc.sh start
```

---

## 📊 Monitoring

### View Workflow Runs

https://github.com/witchsurf/surjudgingcloud/actions

### Check Runner Health

```bash
# On VPS
curl localhost:8080/health  # If health endpoint is configured

# Or check process
ps aux | grep Runner.Listener
```

---

## 🎯 Benefits of Self-Hosted Runner

| Feature | GitHub-Hosted | Self-Hosted |
|---------|---------------|-------------|
| **Access to Local Network** | ❌ No | ✅ Yes |
| **Faster Deployments** | ⚠️ Medium | ✅ Fast |
| **No SSH Required** | ❌ Needs SSH | ✅ Direct Access |
| **Cost** | ✅ Free (limits) | ✅ Free |
| **Maintenance** | ✅ None | ⚠️ You manage |

---

## ✨ Next Steps

1. **Install runner on VPS** (follow steps above)
2. **Test workflow**: Push a small change and watch it deploy
3. **Configure secrets**: Add any needed secrets in GitHub Settings
4. **Set up monitoring**: Configure alerts for deployment failures

---

## 📞 Need Help?

- Runner docs: https://docs.github.com/en/actions/hosting-your-own-runners
- Runner releases: https://github.com/actions/runner/releases
- Community: https://github.community/c/actions

