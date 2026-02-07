# Setup Réseau Local + Docker Alternatives (macOS 12 + Android)

## Contexte
- Mac : macOS 12.7.6
- Tablettes : Galaxy Tab A 8.0 (2019) Android
- Routeur : D-Link DSL-2740U
- Objectif : **fonctionner en réseau local (offline LAN)**

---

## 1) Réseau local : base
- IP routeur : `192.168.1.1`
- IP Mac : `192.168.1.3`

### Réservation DHCP (D-Link)
- MAC Wi-Fi du Mac : `94:f6:d6:1b:6a:3e`
- **Format accepté** : sans `:`
  - `94F6D61B6A3E`
- IP réservée : `192.168.1.3`

Commandes utiles sur Mac :
```bash
networksetup -getmacaddress Wi-Fi
ifconfig | grep "inet " | grep -v 127.0.0.1
```

---

## 2) Configuration locale (LAN)

### `infra/.env`
```
API_EXTERNAL_URL=http://192.168.1.3:8000
SITE_URL=http://192.168.1.3:3000
```

### `frontend/.env.local`
```
VITE_SUPABASE_URL=http://192.168.1.3:8000
VITE_SITE_URL=http://192.168.1.3:5173
```

---

## 3) Démarrage Supabase local
```bash
cd /Users/sandy/Desktop/judging/infra
docker compose -f docker-compose-local.yml up -d
docker ps
```

---

## 4) Tests LAN
- Test API (tablette) :
  - `http://192.168.1.3:8000/rest/v1/`
- App web :
  - Juge : `http://192.168.1.3:5173/judge`
  - Display : `http://192.168.1.3:5173/display`
  - Admin : `http://192.168.1.3:5173/admin`

---

## 5) Problème Docker sur macOS 12
- Docker Desktop récent demande macOS 14+
- Docker Desktop ancien n’est plus officiellement disponible

---

## 6) Alternatives Docker

### A) Docker Desktop ancien (non supporté)
- Versions compatibles macOS 12 : **4.24.x ou 4.23.x**
- Pas garanti : Docker ne distribue plus officiellement les DMG anciens
- Si un DMG ancien existe : installer + désactiver auto-update

### B) Colima (macOS)
- Installation :
```bash
brew install colima docker
```
- Problème rencontré : `qemu-img not found`
- Tentative :
```bash
brew install qemu
```
- Échec : QEMU ne compile pas sur macOS 12 (Clang trop ancien)

**Conclusion** : Colima avec QEMU bloqué sur macOS 12 Intel.

### C) Colima + `vz` (Apple Silicon uniquement)
```bash
colima start --vm-type=vz
```
- Non disponible sur Mac Intel.

---

## 7) Solution recommandée (macOS 12 Intel) : VM Linux locale

👉 **UTM + Ubuntu Server 22.04** (offline LAN possible)

### Étapes
1. Installer **UTM**
2. Télécharger ISO **Ubuntu Server 22.04**
3. Créer la VM :
   - CPU : 2+
   - RAM : 4–8 GB
   - Disk : 40 GB
   - Network : **Bridged** (Wi-Fi)
4. Installer Ubuntu (cocher **OpenSSH Server**)
5. Récupérer IP VM :
   ```bash
   ip a
   ```
6. Installer Docker dans la VM :
   ```bash
   sudo apt update
   sudo apt install -y ca-certificates curl gnupg
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   echo \
     "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
     $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt update
   sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo usermod -aG docker $USER
   newgrp docker
   docker version
   ```
7. Copier le repo dans la VM :
   ```bash
   scp -r /Users/sandy/Desktop/judging <user>@<IP_VM>:/home/<user>/surjudgingcloud
   ```
8. Lancer Supabase local dans la VM :
   ```bash
   cd ~/surjudgingcloud/infra
   docker compose -f docker-compose-local.yml up -d
   docker ps
   ```
9. Utiliser l’IP de la VM pour les tablettes :
   - Exemple : `http://192.168.1.20:5173/judge`

---

## 8) Option VPS (online uniquement)
- Possible si Internet OK
- Pas d’offline LAN
- Tablettes accèdent via `https://ton-domaine`

---

## Résumé
✅ **Offline LAN** : UTM + Ubuntu Server + Docker
✅ **Online** : VPS

