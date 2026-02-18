## 🏁 Workflow de Début de Compétition

> [!IMPORTANT]
> **La création de l'événement se fait TOUJOURS sur le Cloud.**
> La base locale est une "miroir" de terrain. Vous ne pouvez pas créer un événement valide directement en local car il manquerait les métadonnées de paiement et de compte global.

1.  **Sur Internet** : Allez sur `https://surfjudging.cloud`.
2.  **Création** : Créez votre événement, gérez vos catégories et vos inscrits.
3.  **Bascule Terrain** : Connectez votre Mac au réseau local (LAN).
4.  **Synchronisation "Bim!"** : Lancez la synchro depuis votre App locale pour rapatrier les données du Cloud vers la VM.

### 1. Configuration Automatique (Recommandé) ✨

Pour éviter de modifier les fichiers manuellement, un script s'en occupe pour vous sur votre Mac :

1.  Ouvrez un terminal dans le dossier du projet.
2.  Lancez le script :
    ```bash
    ./auto-setup-field.sh
    ```
    *Il détectera votre IP, mettra à jour vos fichiers `.env.local` et vous donnera la commande finale à copier sur votre VM.*

### 2. Configuration Manuelle (Si besoin)

1.  Allez dans le dossier `infra/`.
2.  Copiez `.env.example` vers `.env`.
3.  **IMPORTANT** : Changez `API_EXTERNAL_URL` pour qu'il utilise l'IP locale de la machine (ex: `http://192.168.1.69:8000`).
4.  Lancez la base de données :
    ```bash
    sudo docker compose -f docker-compose-local.yml up -d
    ```

### 2. Configuration de l'Application (Frontend)

1.  Dans le dossier `frontend/`, créez un fichier `.env.local`.
2.  Configurez les deux mondes (Cloud et Local) :
    *   `VITE_SUPABASE_URL_CLOUD` : L'URL de votre projet Supabase en ligne.
    *   `VITE_SUPABASE_ANON_KEY_CLOUD` : La clé "anon" de votre projet en ligne.
    *   `VITE_SUPABASE_URL_LAN` : L'adresse de votre VM locale (`http://192.168.1.69:8000`).

### 3. Synchronisation "Bim!" (Première fois)

Une fois l'App lancée (`npm run dev -- --host`) :
1.  Ouvrez l'App sur votre navigateur.
2.  Allez dans **"Mes Événements"**.
3.  Cliquez sur **"Sync depuis Cloud"**.
4.  Entrez vos identifiants Cloud (Email + Mot de passe).
5.  **Bim !** Vos événements sont rapatriés dans la base locale.

## 🔐 Isolation des Utilisateurs

*   Chaque organisateur ne voit **que ses propres événements**, même sur le réseau local.
*   Si vous prêtez votre machine à un autre organisateur, il devra faire sa propre synchro "Bim!" pour voir ses données.
*   Les données sont filtrées par `user_id` pour garantir la confidentialité entre les comptes.

## 📱 Connexion des Tablettes (Kiosk)

Les juges et le public se connectent simplement à l'IP du serveur (ex: `http://192.168.1.75:5173`). Ils liront les données directement depuis la VM locale, sans aucun accès internet requis.
