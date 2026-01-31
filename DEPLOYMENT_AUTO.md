# 🚀 Déploiement Automatique sur VPS

Ce document explique comment configurer le déploiement automatique de l'application sur votre VPS.

## 📋 Architecture

```
GitHub Push → GitHub Actions → SSH vers VPS → Build & Deploy
```

## 🔧 Configuration Requise

### 1. Secrets GitHub

Allez dans votre repo GitHub : **Settings > Secrets and variables > Actions > New repository secret**

Créez les secrets suivants:

| Secret | Valeur | Description |
|--------|--------|-------------|
| `VPS_SSH_KEY` | Votre clé SSH privée | Clé pour se connecter au VPS |
| `VPS_HOST` | `195.35.2.170` | Adresse IP du VPS |
| `VPS_USER` | `root` | Utilisateur SSH |
| `VPS_PATH` | `/opt/judging` | Chemin du projet sur le VPS |

### 2. Générer une clé SSH (si nécessaire)

Sur votre machine locale:

```bash
# Générer une nouvelle clé SSH pour le déploiement
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy

# Copier la clé publique sur le VPS
ssh-copy-id -i ~/.ssh/github_deploy.pub root@195.35.2.170

# Afficher la clé privée (à copier dans VPS_SSH_KEY)
cat ~/.ssh/github_deploy
```

### 3. Préparer le VPS

Connectez-vous au VPS et assurez-vous que:

```bash
# Le répertoire existe
cd /opt/judging

# Docker et Docker Compose sont installés
docker --version
docker compose version

# Node.js est installé (v18+)
node --version
npm --version
```

## 🎯 Comment ça marche

### Déploiement Automatique

1. **Push vers main** → Le workflow se déclenche automatiquement
2. **GitHub Actions** exécute le workflow [deploy.yml](.github/workflows/deploy.yml)
3. **Sync des fichiers** → rsync vers `/opt/judging` sur le VPS
4. **Build & Deploy** → Exécute [deploy_on_vps.sh](deploy_on_vps.sh) sur le VPS
5. **Notification** → Statut du déploiement dans l'onglet Actions

### Déploiement Manuel

Vous pouvez aussi déclencher un déploiement manuellement:

1. Allez dans **Actions** sur GitHub
2. Sélectionnez **Deploy to VPS**
3. Cliquez sur **Run workflow**

## 📝 Script de Déploiement

Le script [deploy_on_vps.sh](deploy_on_vps.sh) effectue:

1. ✅ Installation des dépendances npm
2. ✅ Build du frontend
3. ✅ Rebuild des containers Docker
4. ✅ Redémarrage des services

## 🔍 Vérifier le Déploiement

Après chaque déploiement, testez:

1. **Interface Admin**: https://surfjudging.cloud/my-events
2. **Écran Display**: https://surfjudging.cloud/display
3. **Interface Juge**: Tester un lien kiosk

## 🐛 Dépannage

### Le déploiement échoue

1. Vérifiez les logs dans **GitHub Actions**
2. Connectez-vous au VPS: `ssh root@195.35.2.170`
3. Vérifiez les logs Docker: `cd /opt/judging/infra && docker compose logs -f`

### Erreur SSH

- Vérifiez que la clé SSH est bien configurée dans les secrets GitHub
- Testez la connexion manuellement: `ssh root@195.35.2.170`

### Build Frontend échoue

```bash
# Sur le VPS
cd /opt/judging/frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Docker ne démarre pas

```bash
# Sur le VPS
cd /opt/judging/infra
docker compose down
docker compose up -d
docker compose logs -f
```

## 📊 Monitoring

Surveillez les déploiements:

- **GitHub Actions**: Onglet Actions de votre repo
- **VPS Logs**: `docker compose logs -f` dans `/opt/judging/infra`
- **Status des containers**: `docker compose ps`

## 🔄 Rollback

En cas de problème, revenez à une version précédente:

```bash
# Sur le VPS
cd /opt/judging
git log --oneline  # Voir les commits
git checkout <commit-hash>  # Revenir à un commit
./deploy_on_vps.sh  # Redéployer
```

## 🎯 Prochaines Étapes

1. ✅ Push vers `main` pour tester le déploiement automatique
2. ✅ Vérifier les logs dans GitHub Actions
3. ✅ Tester l'application sur https://surfjudging.cloud
