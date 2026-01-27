# Guide : Système de Jugement en Réseau Local

## 🎯 Objectif

Faire fonctionner le système sur réseau local (WiFi LAN) sans dépendance Internet pour éviter les problèmes de connexion lors des compétitions.

**Architecture :**
- 1 PC Principal → Serveur Supabase local
- 3 Tablettes Juges → Clients
- 1 Écran Display → Client

---

## 📋 Prérequis

### Matériel
- **PC Principal** (Windows/Mac/Linux)
  - 8 GB RAM minimum
  - 20 GB espace disque
  - WiFi ou Ethernet
- **3 Tablettes** (iPad, Android, Windows)
- **Routeur WiFi** ou Hotspot WiFi du PC

### Logiciels sur PC
```bash
# 1. Docker Desktop
# Mac: https://www.docker.com/products/docker-desktop
# Windows: https://www.docker.com/products/docker-desktop
# Linux: sudo apt install docker.io docker-compose

# 2. Node.js 20+
# https://nodejs.org/

# 3. Git
# https://git-scm.com/
```

---

## 🚀 Installation Étape par Étape

### Étape 1 : Cloner le Projet

```bash
# Sur le PC principal
cd /chemin/vers/vos/projets
git clone https://github.com/witchsurf/surjudgingcloud.git
cd surjudgingcloud
```

### Étape 2 : Configurer l'Environnement Local

```bash
# Copier le fichier d'environnement
cd infra
cp .env.local .env

# Éditer .env et ajuster l'IP du PC
# Trouver votre IP locale :

# Mac/Linux:
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows:
ipconfig | findstr IPv4

# Exemple si IP = 192.168.1.15
# Modifier dans .env :
# API_EXTERNAL_URL=http://192.168.1.15:8000
# SITE_URL=http://192.168.1.15:3000
```

### Étape 3 : Démarrer Supabase Local

```bash
# Depuis le dossier infra/
docker-compose -f docker-compose-local.yml up -d

# Vérifier que tout tourne
docker ps

# Vous devriez voir :
# surfjudging_postgres
# surfjudging_kong
# surfjudging_realtime
# surfjudging_auth
# surfjudging_rest
# surfjudging_storage
# surfjudging_meta
# surfjudging_studio
```

### Étape 4 : Initialiser la Base de Données

```bash
# Appliquer les migrations
cd ../backend/supabase
supabase db push --db-url postgresql://postgres:SurfJudging2026SecurePassword@localhost:5432/postgres

# Ou manuellement via Studio
# Ouvrir http://localhost:3000 (Supabase Studio)
# SQL Editor → Coller le contenu des migrations
```

### Étape 5 : Configurer le Frontend

```bash
# Créer .env.local dans frontend/
cd ../../frontend
cat > .env.local << EOF
VITE_SUPABASE_URL=http://192.168.1.15:8000
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
VITE_SITE_URL=http://192.168.1.15:5173
EOF

# Remplacer 192.168.1.15 par votre IP réelle
```

### Étape 6 : Build et Servir l'Application

**Option A : Mode Développement (Recommandé pour tests)**
```bash
npm install
npm run dev -- --host

# L'app sera accessible sur :
# http://192.168.1.15:5173
```

**Option B : Mode Production**
```bash
npm run build

# Servir avec serve
npx serve -s dist -l 5173 --host 0.0.0.0

# Ou avec nginx (voir configuration ci-dessous)
```

---

## 📱 Configuration des Tablettes

### Sur Chaque Tablette

1. **Connecter au même WiFi** que le PC principal

2. **Ouvrir le Navigateur** (Chrome, Safari, Edge)

3. **Accéder à l'URL** :
   ```
   http://192.168.1.15:5173/judge
   ```
   (Remplacer par l'IP réelle du PC)

4. **Login Juge** :
   - Créer un compte juge
   - Ou utiliser compte existant

5. **Ajouter à l'Écran d'Accueil** (PWA) :
   - **iOS** : Safari → Partager → "Sur l'écran d'accueil"
   - **Android** : Chrome → Menu → "Ajouter à l'écran d'accueil"
   - **Windows** : Edge → Menu → "Installer l'application"

---

## 🧪 Tests de Validation

### Test 1 : Connectivité Réseau

```bash
# Sur chaque tablette, ouvrir le navigateur et tester :
http://192.168.1.15:8000/rest/v1/

# Devrait afficher une réponse JSON
# Si erreur "Cannot connect" → Vérifier firewall/IP
```

### Test 2 : Realtime Sync

1. **PC Principal** : Ouvrir http://192.168.1.15:5173/admin
2. **Tablette 1** : Ouvrir http://192.168.1.15:5173/judge
3. **Sur Admin** : Démarrer le timer
4. **✅ Vérifier** : Le timer démarre sur la tablette juge

### Test 3 : Score Sync

1. **Tablette 1** : Entrer un score
2. **PC Display** : Ouvrir http://192.168.1.15:5173/display
3. **✅ Vérifier** : Le score s'affiche immédiatement

### Test 4 : Mode Offline (Bonus)

1. **Déconnecter le WiFi du PC** (après que tablettes sont connectées)
2. **Sur Tablette** : Entrer des scores
3. **Reconnecter WiFi**
4. **✅ Vérifier** : Les scores se synchronisent automatiquement

---

## 🔧 Configuration Nginx (Option Production)

Si vous voulez utiliser Nginx au lieu de `npm run dev` :

```nginx
# /etc/nginx/sites-available/surfjudging-local

server {
    listen 80;
    server_name 192.168.1.15;

    # Frontend
    location / {
        root /chemin/vers/surfjudgingcloud/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Supabase API Proxy
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Activer le site
sudo ln -s /etc/nginx/sites-available/surfjudging-local /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🛡️ Sécurité Réseau Local

### Firewall (PC Principal)

**Mac:**
```bash
# Autoriser ports 5173 (app) et 8000 (Supabase)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node
```

**Windows:**
```powershell
# Panneau de configuration → Pare-feu Windows
# Nouvelle règle entrante → Port
# TCP 5173, 8000
# Autoriser la connexion
```

**Linux:**
```bash
sudo ufw allow 5173/tcp
sudo ufw allow 8000/tcp
sudo ufw reload
```

### HTTPS Local (Optionnel)

Pour utiliser HTTPS en local (requis pour certaines fonctionnalités PWA) :

```bash
# Générer certificat auto-signé
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Vite avec HTTPS
npm run dev -- --host --https --cert cert.pem --key key.pem
```

**⚠️ Attention :** Navigateurs afficheront un warning (certificat auto-signé), cliquer "Avancé" → "Continuer"

---

## 📊 Monitoring & Debug

### Vérifier État des Services

```bash
# Logs Supabase
docker logs surfjudging_postgres --tail 50
docker logs surfjudging_realtime --tail 50
docker logs surfjudging_kong --tail 50

# Si erreurs :
docker-compose -f docker-compose-local.yml down
docker-compose -f docker-compose-local.yml up -d
```

### Supabase Studio (UI Admin)

```
http://192.168.1.15:3000

# Login avec :
# URL: http://192.168.1.15:8000
# Anon Key: (voir .env.local)
```

### Network Inspector

Sur tablette, ouvrir DevTools :
- **iOS** : Activer "Web Inspector" dans Réglages → Safari → Avancé
- **Android** : Chrome → Menu → Plus d'outils → Outils de développement

Vérifier :
- Requêtes vers `http://192.168.1.15:8000` → Status 200
- WebSocket vers `ws://192.168.1.15:8000/realtime/v1` → Connected

---

## 🔄 Mode Hybride (Cloud + Local)

Pour basculer entre cloud et local :

```bash
# Frontend .env
VITE_SUPABASE_URL=http://192.168.1.15:8000  # Local
# VITE_SUPABASE_URL=https://xxxx.supabase.co  # Cloud

# Commentez/décommentez selon besoin
```

**Workflow Hybride :**
1. **Sur le terrain** : Mode local (réseau WiFi)
2. **Après compétition** : Export JSON → Import vers cloud
3. **Sync automatique** quand Internet revient (si offline queue active)

---

## ❓ Troubleshooting

### Problème : Tablettes ne se connectent pas

**Solutions :**
1. Vérifier même WiFi : `ipconfig` (PC) et Settings → WiFi (tablette)
2. Ping depuis tablette : Installer "Network Analyzer" app → Ping 192.168.1.15
3. Firewall : Désactiver temporairement pour tester
4. IP correcte : Vérifier que `.env.local` a la bonne IP

### Problème : Timer ne sync pas

**Solutions :**
1. Console Browser (F12) → Vérifier erreurs WebSocket
2. Logs Realtime : `docker logs surfjudging_realtime --tail 100`
3. Vérifier table `heat_realtime_config` existe :
   ```sql
   SELECT * FROM heat_realtime_config LIMIT 1;
   ```

### Problème : Scores ne s'enregistrent pas

**Solutions :**
1. Vérifier trigger SQL :
   ```sql
   SELECT proname FROM pg_proc WHERE proname LIKE '%block_scoring%';
   -- Devrait retourner: fn_block_scoring_when_closed
   ```
2. Vérifier status heat :
   ```sql
   SELECT heat_id, status FROM heat_realtime_config;
   -- Status doit être 'running', pas 'waiting' ou 'closed'
   ```

### Problème : Performance lente

**Solutions :**
1. Vérifier RAM Docker : Docker Desktop → Settings → Resources → 4GB minimum
2. Index manquants : Appliquer migration `20251221000000_add_performance_indexes.sql`
3. Réduire polling : Augmenter intervalle realtime dans `useRealtimeSync.ts`

---

## 📦 Backup & Export

### Sauvegarder la Base de Données

```bash
# Export complet
docker exec surfjudging_postgres pg_dump -U postgres postgres > backup_$(date +%Y%m%d).sql

# Import vers cloud
psql -h xxxx.supabase.co -U postgres -d postgres < backup_20260127.sql
```

### Export JSON (Alternative)

Via Supabase Studio :
1. Table → `scores` → Export CSV
2. Répéter pour `heats`, `participants`, `events`
3. Importer sur cloud via Studio

---

## 🎉 Checklist de Déploiement

- [ ] Docker installé et fonctionnel
- [ ] IP locale identifiée (ex: 192.168.1.15)
- [ ] `.env.local` configuré avec la bonne IP
- [ ] `docker-compose up -d` réussi (8 containers running)
- [ ] Migrations SQL appliquées
- [ ] Frontend build et servi (`npm run dev --host`)
- [ ] Firewall autorise ports 5173 et 8000
- [ ] Tablette 1 connectée et teste timer sync ✅
- [ ] Tablette 2 connectée et teste score sync ✅
- [ ] Tablette 3 connectée et teste score sync ✅
- [ ] Display connecté et affiche scores en temps réel ✅
- [ ] Test offline : Scores sauvegardés localement ✅
- [ ] Test reconnexion : Sync automatique ✅

---

**Temps d'installation estimé :** 30-45 minutes
**Difficulté :** Intermédiaire
**Support :** Ouvrir issue sur GitHub si problème

Bon jugement ! 🏄‍♂️
