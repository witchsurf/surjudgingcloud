# Rapport P1 — stabilisation du serveur local

## Portée

Implémentation réalisée sans Electron, SQLite, remplacement de Supabase, changement de scoring, WAL, timer ou synchronisation Cloud ↔ HP. `event-box` et `beach` n’ont pas été modifiés.

## Fichiers

Créés : asset SVG local, utilitaire/tests réseau, test de routes, audit automatisé du build et les quatre documents P1.

Modifiés : écrans utilisant l’image distante, diagnostic opérateur, collecte des diagnostics locaux, health-check Supabase et scripts `hp-healthcheck.sh`, `hp-ops.sh`, `hp-field-smoke-test.mjs`. Le health-check est conservé dans ses deux emplacements miroir.

## Résultats

- Suite frontend complète : 76 tests réussis sur 17 fichiers, dont 21 tests dédiés aux URL/routes P1.
- Build Vite production : réussi, 2 355 modules transformés.
- Audit statique et navigateur : réussi ; 0 URL d’asset interdite, 0 marqueur distant, 0 requête publique.
- Routes : `/admin` 200 ; `/chief-judge` 200 puis redirection `/admin` ; `/judge`, `/priority`, `/display` 200 ; aucune `/chief`.
- Syntaxe : scripts shell et JavaScript P1 validés.

## Limites et risques ouverts

Le contrôle Realtime nécessite une stack locale en fonctionnement pour être validé en conditions HP. L’état réseau du navigateur indique la disponibilité de son interface, pas la qualité radio. Une requête `no-cors` vers l’ESP32 confirme sa joignabilité sans garantir l’état fonctionnel de chaque bouton. Le test `hp-field-smoke` complet reste à exécuter sur le HP avec un événement local actif. Le risque R15 de restauration complète Supabase reste ouvert et non bloquant pour P1.

`npm ci` signale 25 vulnérabilités de dépendances (dont 2 critiques) ; aucune mise à niveau automatique n’a été appliquée afin d’éviter un changement de comportement hors périmètre.
