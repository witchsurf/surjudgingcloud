# SurfJudging Field — préparation graphique de la machine

Statut : implémenté dans le candidat Desktop 0.5.0, tests automatisés PASS ;
installation et premier démarrage sur le Mac Ventura de Sandy à certifier.

## Principe

L’opérateur n’utilise ni Terminal, ni dépôt source. Avant une compétition et
pendant qu’Internet est disponible, l’application :

1. identifie macOS, la version, l’architecture, la mémoire et l’espace libre ;
2. cherche un moteur Docker déjà opérationnel, y compris lorsque Finder ne
   fournit pas le même `PATH` qu’un Terminal ;
3. démarre Docker Desktop s’il est installé mais arrêté ;
4. si nécessaire, sélectionne uniquement un installateur approuvé pour la
   combinaison OS/architecture ;
5. demande un consentement explicite, télécharge depuis `desktop.docker.com`,
   puis vérifie la taille, SHA-256, l’image DMG, le Team ID Docker Inc
   `9BNSXJN65R` et le bundle `com.docker.docker` ;
6. déclenche la fenêtre native macOS d’autorisation administrateur, sans lire
   ni conserver le mot de passe ;
7. lance Docker Desktop et attend réellement que le moteur réponde avant de
   déclarer la machine prête.

La préparation ne lit et ne modifie aucune base de compétition. Une fois le
moteur et le payload Field installés, le jugement reste local et fonctionne
sans Internet.

## Matrice actuellement approuvée pour le téléchargement automatique

| Hôte | Installateur choisi | Contrôles |
| --- | --- | --- |
| macOS Ventura 13.3+ Intel | Docker Desktop 4.48.0, build 207573, amd64 | URL fixe, taille, SHA-256, signature éditeur |
| macOS Ventura 13.3+ Apple Silicon | Docker Desktop 4.48.0, build 207573, arm64 | URL fixe, taille, SHA-256, signature éditeur |

Une version de macOS ou une architecture sans profil approuvé échoue de façon
fermée : l’application n’installe pas arbitrairement la dernière version de
Docker. Ce point protège notamment Ventura, qui n’est plus accepté par les
versions Docker Desktop actuelles.

## États opérateur

- `READY` : moteur compatible réellement joignable ; Field peut démarrer.
- `DOCKER_STOPPED` : Docker Desktop existe ; l’application le lance et attend.
- `DOWNLOAD_REQUIRED` : téléchargement vérifié et autorisation nécessaires.
- `DISK_INSUFFICIENT` : moins de 20 Go libres ; aucune installation.
- `UNSUPPORTED` : aucun profil approuvé ; aucune installation automatique.

## Limites de certification

- Le candidat 0.5.0 local est non signé pour distribution : aucun certificat
  Developer ID Application utilisable n’est disponible dans le trousseau.
- Le téléchargement, l’invite administrateur, la licence Docker, le premier
  démarrage en ligne, puis deux démarrages hors ligne doivent être observés sur
  un Mac Ventura propre avant de déclarer ce parcours certifié terrain.
- Le téléchargement automatique Windows 11 reste à implémenter et certifier ;
  la détection d’un Docker existant reste compatible avec son chemin standard.
