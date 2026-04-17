# 🏝️ Guide du Mode 100% Hors-Ligne (Réseau Local)

L'architecture PWA que nous venons de mettre en place sert à protéger les juges des **coupures intermittentes** lorsque l'événement est branché sur le Cloud (Internet). 

Cependant, la demande actuelle est différente : **mener tout un événement sans accès à Internet de A à Z**, en utilisant un ordinateur maître comme serveur et un routeur WiFi local.

Bonne nouvelle : **L'application est DÉJÀ architecturée pour ça.** Voici comment cela fonctionne techniquement et comment le mettre en place.

---

## 🏗️ Architecture "Réseau Local" (LAN)

Dans ce mode, la dépendance à Internet et au Cloud Supabase disparaît totalement.
1. **Le Routeur WiFi** : Déploie un routeur WiFi sur la plage (pas besoin de carte SIM ou de connexion Web, il fait juste transiter les requêtes locales).
2. **Le Serveur Maître (L'ordinateur de la régie)** : Fait tourner l'application et la base de données via Docker. Branché au routeur (idéalement par câble Ethernet). Son adresse IP devient l'adresse de l'événement (ex: `192.168.1.69`).
3. **Les Tablettes Juges** : Connectées au réseau WiFi du routeur, elles accèdent à l'application via l'IP du serveur (`http://192.168.1.69:5173`).

---

## ⚙️ Configuration Technique (Le fichier `.env`)

Pour que cela fonctionne, les tablettes doivent savoir qu'elles ne doivent **pas** chercher à taper sur le cloud `*.supabase.co`, mais sur la machine locale. L'application possède une fonction de résorption automatique pour cela, gérée dans `frontend/src/lib/supabase.ts`.

Dans votre fichier `frontend/.env.local`, l'architecture est déjà prête :
```env
# IP de l'ordinateur qui sert de serveur
VITE_SUPABASE_URL_LAN=http://192.168.1.69:8000
VITE_SUPABASE_ANON_KEY_LAN=[votre_cle_locale]

# Mode Dev / Test de résorption
VITE_DEV_MODE=true
```

Le fichier `supabase.ts` détecte automatiquement que si l'URL dans le navigateur commence par `192.168...`, il bascule le système en `mode = 'local'` et injecte la clé LAN.

---

## 🏄 L'Outil Simplifié : `scripts/field-menu.sh`

Pour rendre la transition vers le réseau local extrêmement simple et sans ligne de commande compliquée, un script interactif a été créé sur votre Mac.

Ouvrez un terminal, placez-vous dans le dossier du projet, et lancez :
```bash
./scripts/field-menu.sh
```

Un menu apparaîtra avec deux options simples :

1. **🌐 ÉTAPE 1 : Préparation Maison (Avec Internet)**
   - À faire chez soi avant de partir à la compétition.
   - Ce choix va recompiler automatiquement tout le code et relancer les serveurs internes.
   - Le script vous demandera ensuite d'ouvrir l'application pour cliquer sur "Sync from Cloud" afin de télécharger les données des événements sur votre ordinateur.

2. **🏖️ ÉTAPE 2 : Lancer le Mode Plage (Sans Internet)**
   - À faire une fois arrivé sur le lieu de la compétition.
   - Branchez l'ordinateur au routeur WiFi local, et connectez les tablettes.
   - Lancez ce choix 2. Le script va vérifier que le serveur tourne bien.
   - **Il s'occupera d'afficher en grand l'adresse exacte (URL) à taper sur les tablettes ainsi que le Code PIN de secours.**

### 🔐 Force Override (Secours Optionnel)
Si jamais les tablettes s'entêtaient à vouloir taper le cloud, l'interface du Chef Juge (`/admin`) possède un bouton caché ou un menu de paramètres (souvent via un clic long sur l'icône de connexion) pour écraser manuellement l'URL Supabase (`supabase_url_override`), forçant la tablette à pointer sur l'ordinateur local.

Tout est déjà en place dans le code. Vous n'avez plus qu'à organiser le matériel sur le sable !
