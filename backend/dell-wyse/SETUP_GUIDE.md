# 🖥️ Guide d'Installation — Supabase sur Dell Wyse 5070

Le Dell Wyse 5070 (Intel Celeron/Pentium) est parfait car il utilise l'architecture **x86_64**, la même que les serveurs pro. Le SSD inclus rendra ta base de données hyper réactive.

---

## Phase 1 — Installation du Système (Option Pro recommandée)

Je recommande d'installer **Ubuntu Server 24.04 LTS** (64-bit) pour avoir 100% de la RAM disponible pour Supabase.

1. **Préparer une clé USB** avec [Ubuntu Server](https://ubuntu.com/download/server).
2. **Booter sur la clé** (Appuie sur `F12` au démarrage du Dell).
3. **Installation** :
   - Choisis "Ubuntu Server (minimal)".
   - Configure ton WiFi ou Ethernet durant l'installation.
   - **Important** : Coche "Install OpenSSH Server".

---

## Phase 2 — Installation de Docker

Une fois connecté en SSH à ton Dell Wyse :

```bash
# Installation de Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit # Reconnecte-toi pour activer les droits
```

---

## Phase 3 — Déploiement de Supabase

```bash
mkdir -p ~/supabase && cd ~/supabase
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker
cp .env.example .env

# Génère tes propres clés ou utilise tes clés actuelles
# Modifie le .env comme dans le guide précédent
nano .env
```

> **Note sur le Wyse** : Contrairement au Pi, tu n'es pas obligé de désactiver tous les services (tu as 8 Go de RAM !), mais tu peux quand même le faire pour que la machine reste froide et silencieuse.

---

## Phase 4 — Configuration Réseau (IP Fixe 10.0.0.24)

Pour conserver tes réglages actuels sans rien changer au frontend :

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

Adapte la configuration (exemple pour Ethernet `eth0`) :

```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - 10.0.0.24/24
      gateway4: 10.0.0.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

```bash
sudo netplan apply
```

---

## 🎯 Le Bonus : Mode "Combo Serveur + Affichage"

Le Dell Wyse possède des ports DisplayPort. Tu peux l'utiliser pour faire tourner le serveur **ET** afficher le score sur un grand écran de plage.

### 1. Installer un environnement graphique léger
```bash
sudo apt install --no-install-recommends xserver-xorg x11-xserver-utils xinit openbox chromium-browser
```

### 2. Créer un script d'autostart pour Chromium
```bash
nano ~/start_display.sh
```
Contenu :
```bash
#!/bin/bash
xset -dpms
xset s off
xset s noblank
# Attend que Docker soit prêt
sleep 30
chromium-browser --kiosk http://localhost:5173/display
```

---

## Pourquoi le Dell Wyse 5070 gagne sur le terrain :

1. **Vraie dissipation thermique** : Il ne ralentira pas sous le soleil de Sénégal contrairement au Pi qui chauffe vite.
2. **Ports USB à gogo** : Pratique pour brancher des périphériques ou charger une tablette en secours.
3. **SSD M.2** : Si le SSD de 128 Go meurt dans 3 ans, tu le changes en 2 minutes (impossible sur Pi).
4. **Alimentation Standard** : Le bloc secteur est plus costaud qu'un chargeur USB-C.

### 💡 Conseil pour ton achat :
Assure-toi qu'il est livré avec son **bloc d'alimentation original**. C'est un Dell, donc n'importe quel chargeur de laptop Dell 65W (embout bleu/noir standard) fonctionnera si besoin.

**Dès que tu reçois l'engin, on pourra faire le transfert de ta VM actuelle vers ce serveur physique !** 🚀
