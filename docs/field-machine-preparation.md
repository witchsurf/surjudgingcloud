# SurfJudging Field — préparation graphique de la machine

Statut : préparation macOS et Windows 11 x64 implémentée, tests automatisés
PASS ; parcours Windows réel à certifier sur une machine vierge.

## Principe

L’opérateur n’utilise ni Terminal, ni dépôt source. Avant une compétition et
pendant qu’Internet est disponible, l’application :

1. identifie macOS ou Windows, la version, l’architecture, la mémoire et
   l’espace libre ;
2. cherche un moteur Docker déjà opérationnel, y compris lorsque Finder ne
   fournit pas le même `PATH` qu’un Terminal ;
3. démarre Docker Desktop s’il est installé mais arrêté ;
4. si nécessaire, sélectionne uniquement un installateur approuvé pour la
   combinaison OS/architecture ;
5. demande un consentement explicite, télécharge depuis `desktop.docker.com`,
   puis vérifie la taille, SHA-256, l’image DMG, le Team ID Docker Inc
   `9BNSXJN65R` et le bundle `com.docker.docker` ;
6. déclenche la fenêtre native d’autorisation administrateur, sans lire ni
   conserver le mot de passe ; sous Windows, elle active ou met à jour WSL 2
   lorsque nécessaire et impose le redémarrage au lieu de déclarer la machine
   prête prématurément ;
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
| Windows 11 23H2+ x64 | Docker Desktop 4.88.1, build 237512, amd64 | URL fixe, taille, SHA-256, signature Authenticode Docker Inc, installation WSL 2 par utilisateur |

Une version de macOS ou une architecture sans profil approuvé échoue de façon
fermée : l’application n’installe pas arbitrairement la dernière version de
Docker. Ce point protège notamment Ventura, qui n’est plus accepté par les
versions Docker Desktop actuelles.

## États opérateur

- `READY` : moteur compatible réellement joignable ; Field peut démarrer.
- `DOCKER_STOPPED` : Docker Desktop existe ; l’application le lance et attend.
- `WSL_REQUIRED` / `WSL_UPDATE_REQUIRED` : Windows demande l’autorisation UAC
  pour préparer WSL 2.
- `RESTART_REQUIRED` : la préparation Windows attend un redémarrage réel.
- `DOWNLOAD_REQUIRED` : téléchargement vérifié et autorisation nécessaires.
- `MEMORY_INSUFFICIENT` : moins de 8 Go sous Windows ; aucune préparation.
- `DISK_INSUFFICIENT` : moins de 20 Go libres ; aucune installation.
- `UNSUPPORTED` : aucun profil approuvé ; aucune installation automatique.

## Limites de certification

- La préparation Windows est couverte par les tests automatisés mais n’est pas
  encore certifiée sur un PC Windows 11 x64 vierge.
- L’invite UAC, l’activation WSL 2, le redémarrage, l’acceptation visible de la
  licence Docker, le premier démarrage en ligne, puis deux démarrages Field
  hors ligne doivent être observés avant de déclarer ce parcours certifié.
