# Cible produit — installateurs SurfJudging Field génériques

## But opérateur

Un ordinateur Fédération neuf doit être utilisable sans dépôt SurfJudging,
Node.js, npm, Git, ni Terminal. Après une installation graphique réalisée par
un administrateur local, l'opérateur n'utilise que l'application
**SurfJudging Field** : démarrer, vérifier l'état, ouvrir les liens LAN,
sauvegarder et arrêter quand aucune manche ne court.

La première installation peut demander le mot de passe administrateur du
poste pour installer le moteur local. Ce n'est pas une opération quotidienne.

## Variantes livrées

| Artefact | Hôte certifié visé | Moteur local | Statut |
| --- | --- | --- | --- |
| `SurfJudging-Field-mac-intel.dmg` | macOS Ventura 13.3 ou plus, Intel x64 | Moteur Intel gelé et validé pour Ventura | À construire et certifier |
| `SurfJudging-Field-mac-arm64.dmg` | macOS Ventura 13.3 ou plus, Apple Silicon | Moteur Apple Silicon gelé et validé pour Ventura | À construire et certifier |
| `SurfJudging Field Setup 0.6.6.exe` | Windows 11 23H2+ x64, virtualisation activée | Préparation WSL 2 et Docker Desktop 4.88.1 vérifiée automatiquement | Planification man-on-man et payload corrigés ; installateur à construire et certifier |

Un Mac qui ne peut pas exécuter macOS Ventura 13.3 n'entre pas dans cette promesse
générique. Il demande une variante legacy gelée, séparée et testée sur le
matériel réel ; aucune installation ne doit tenter un contournement silencieux.

## Contenu et déroulé

Le support de livraison contient deux installateurs graphiques :

1. le moteur local gelé pour Ventura/Windows, fourni sur le support avec sa
   somme de contrôle et ses conditions de licence ;
2. l'installateur SurfJudging proprement dit, qui contient la release Field,
   le manifeste signé, les images conteneur préchargées et les migrations.

Au premier lancement, SurfJudging vérifie l'architecture, le moteur, les
images, l'identité de release, le schéma et l'absence d'une instance Field
inconnue. Il s'arrête en sécurité avec un message exploitable si l'un de ces
contrôles échoue. Il ne télécharge ni image ni dépendance pendant l'exploitation.

## Données et mises à jour

Les données de compétition vivent dans un emplacement applicatif dédié,
séparé des fichiers de l'application. Une désinstallation ne les efface pas
sans choix explicite. Une mise à jour est acceptée uniquement si les
manifestes, hashes, signature, release et version de schéma correspondent.

## Critères de sortie

- Installation graphique sur un Mac Intel, un Mac Apple Silicon et un PC
  Windows 11 vierges, sans dépôt ni Terminal.
- Premier démarrage hors internet avec images déjà présentes.
- Après redémarrage du poste : démarrage par icône, base et frontend sains.
- Parcours visible Admin, cinq juges distincts, Priorité et Display recoupé
  avec la base autoritative.
- Sauvegarde et restauration testées sur chaque système.
- Une manche en cours interdit l'arrêt depuis l'application.

Tant que ces scénarios ne sont pas exécutés sur les trois familles de
machines, les artefacts restent **PREPARED, NOT CERTIFIED**.
