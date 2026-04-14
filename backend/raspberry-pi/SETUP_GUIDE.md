# 🍓 Guide d'Installation — Supabase sur Raspberry Pi 4/5

## Matériel Recommandé

| Composant | Minimum | Recommandé |
|-----------|---------|------------|
| **Modèle** | Pi 4 (4GB) | **Pi 5 (8GB)** |
| **Carte SD** | 32GB Class 10 | **64GB A2** (plus rapide) |
| **Alimentation** | 5V/3A USB-C | Alim officielle Pi |
| **Réseau** | WiFi intégré | **Ethernet RJ45** (plus stable) |
| **Boîtier** | Optionnel | Avec ventilateur (chaleur Sénégal!) |

> **Budget estimé :** Pi 4 4GB (~55€) / Pi 5 8GB (~95€) + SD + alim ≈ 80-130€

---

## Phase 1 — Préparation du Pi

### 1.1 Flash de l'OS

Sur ton Mac, utilise **Raspberry Pi Imager** :
- Télécharge : https://www.raspberrypi.com/software/
- Choisis : **Raspberry Pi OS Lite (64-bit)** (sans bureau, plus léger)
- Dans les paramètres avancés (⚙️) :
  - ✅ Activer SSH
  - ✅ Définir nom d'utilisateur : `pi` / mot de passe : `[ton-mdp]`
  - ✅ Configurer WiFi (SSID + mot de passe de ta box)
  - ✅ Définir hostname : `surfjudging`

### 1.2 Premier démarrage

```bash
# Insère la carte SD, branche le Pi, attends 2 minutes puis :
ssh pi@surfjudging.local
# Ou si le hostname ne marche pas, trouve l'IP :
# Sur ton Mac : arp -a | grep -i "b8:27:eb\|dc:a6:32\|d8:3a:dd\|2c:cf:67"

# Mise à jour du système
sudo apt update && sudo apt upgrade -y
sudo reboot
```

---

## Phase 2 — Installation de Docker

```bash
# Installer Docker en une commande
curl -fsSL https://get.docker.com | sh

# Ajouter l'utilisateur pi au groupe docker
sudo usermod -aG docker pi

# Se déconnecter et reconnecter pour activer le groupe
exit
ssh pi@surfjudging.local

# Vérifier que Docker fonctionne
docker --version
docker compose version
```

---

## Phase 3 — Installation de Supabase

### 3.1 Cloner Supabase

```bash
# Créer un dossier de travail
mkdir -p ~/supabase && cd ~/supabase

# Télécharger la config Supabase self-hosted
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker

# Copier le fichier de configuration
cp .env.example .env
```

### 3.2 Configurer les variables

```bash
nano .env
```

**Modifications importantes :**

```env
# OBLIGATOIRE — Change ces valeurs pour la sécurité !
POSTGRES_PASSWORD=un-mot-de-passe-tres-fort-ici
JWT_SECRET=une-cle-jwt-secrete-de-minimum-32-caracteres-ici
ANON_KEY=ta-cle-anon-actuelle-de-supabase
SERVICE_ROLE_KEY=ta-cle-service-role-actuelle

# PERFORMANCE — Adapter pour le Pi
POSTGRES_DB=postgres
POSTGRES_HOST=db
POSTGRES_PORT=5432

# RÉSEAU — Le Pi sera accessible sur le réseau local
SITE_URL=http://surfjudging.local:8000
API_EXTERNAL_URL=http://surfjudging.local:8000
```

### 3.3 Optimiser pour le Pi (important!)

```bash
# Désactiver les services non essentiels pour économiser la RAM
# Éditer le docker-compose.yml
nano docker-compose.yml
```

**Commenter ou supprimer ces services** (non utilisés par ton app) :

```yaml
# studio:        # L'interface web admin (utilise beaucoup de RAM)
# imgproxy:      # Redimensionnement d'images (pas utilisé)
# functions:     # Edge Functions (pas utilisé)
# analytics:     # Reporting (pas utilisé)
# vector:        # Logs (pas utilisé sur le Pi)
```

**Services à GARDER :**
- `db` (PostgreSQL)
- `rest` (PostgREST → ton API)
- `realtime` (WebSocket → tes scores live)
- `auth` (GoTrue → login juges)
- `kong` (API Gateway → routage sur le port 8000)
- `meta` (Metadata)

### 3.4 Lancer Supabase

```bash
# Premier lancement (télécharge les images, ~5-10 min sur Pi)
docker compose up -d

# Vérifier que tout tourne
docker compose ps

# Tu dois voir : db, rest, realtime, auth, kong → "Up"
```

---

## Phase 4 — Appliquer le Schéma de ta Base

Depuis ton **Mac** :

```bash
cd /Users/sandy/Desktop/judging

# Trouver l'IP du Pi
PI_IP=$(ping -c1 surfjudging.local | head -1 | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}')
echo "IP du Pi: $PI_IP"

# Appliquer les migrations
for f in backend/supabase/migrations/*.sql; do
  echo "Applying: $f"
  psql "postgres://postgres:un-mot-de-passe-tres-fort-ici@${PI_IP}:5432/postgres" -f "$f"
done
```

---

## Phase 5 — Configurer le Frontend

### 5.1 Fichier .env

```bash
# frontend/.env (développement local)
VITE_SUPABASE_URL=http://surfjudging.local:8000
VITE_SUPABASE_ANON_KEY=ta-cle-anon
```

### 5.2 Test de connexion

```bash
# Depuis ton Mac, vérifie que le Pi répond
curl http://surfjudging.local:8000/rest/v1/

# Tu dois voir : [] ou un JSON de tes tables
```

---

## Phase 6 — Démarrage Automatique au Boot

Sur le Pi :

```bash
# Supabase se relance automatiquement au redémarrage
cd ~/supabase/supabase/docker
docker compose up -d  # Le flag restart: always est déjà dans le compose

# Vérifier qu'il se relance après un reboot
sudo reboot
# Attendre 3 minutes puis...
ssh pi@surfjudging.local
docker compose -f ~/supabase/supabase/docker/docker-compose.yml ps
```

---

## Phase 7 — Setup Jour de l'Événement 🏄

### Checklist avant la LIGUE PRO

```
□ Pi branché sur l'alimentation
□ Pi connecté au même réseau WiFi que les tablettes
□ Vérifier l'IP du Pi (hostname -I)
□ Tester : curl http://PI_IP:8000/rest/v1/heats
□ Mettre l'IP à jour dans .env si elle a changé
□ Lancer npm run build && déployer le frontend
```

### Mode Terrain (Sans Internet)

Le Pi crée un réseau local complet :
- PostgreSQL tourne en local
- L'API REST est locale
- Le Realtime fonctionne en local
- **Aucune connexion internet nécessaire pendant l'événement**

### IP Fixe (Recommandé)

Pour éviter que l'IP change à chaque redémarrage :

```bash
# Sur le Pi
sudo nano /etc/dhcpcd.conf

# Ajouter à la fin :
interface wlan0
static ip_address=10.0.0.24/24
static routers=10.0.0.1
static domain_name_servers=10.0.0.1 8.8.8.8

# OU pour Ethernet :
interface eth0
static ip_address=10.0.0.24/24
static routers=10.0.0.1
static domain_name_servers=10.0.0.1 8.8.8.8

sudo reboot
```

> Utilise `10.0.0.24` pour garder la même IP que ta VM actuelle.

---

## Monitoring & Debug

```bash
# Voir les logs en temps réel
cd ~/supabase/supabase/docker
docker compose logs -f --tail=50

# Voir la RAM utilisée
free -h

# Redémarrer un service spécifique si problème
docker compose restart realtime
```

---

## Résumé Performance Attendue

| Modèle | RAM dispo | Temps de boot | Latence API |
|--------|-----------|---------------|-------------|
| Pi 4 (4GB) | ~1.5GB libre | ~90s | ~15-30ms |
| Pi 5 (8GB) | ~5GB libre | ~45s | ~5-10ms |

Les deux sont largement suffisants pour 3-5 juges + 1 écran public en simultané.
