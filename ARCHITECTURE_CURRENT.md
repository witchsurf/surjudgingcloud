# Architecture actuelle — audit P0

## Périmètre et méthode

Ce document décrit le dépôt au 5 août 2026, sans proposer une nouvelle implémentation. Les sources principales vérifiées sont `README.md`, `docs/hp-operations-runbook.md`, `docs/offline-sync-map.md`, le frontend React, les migrations Supabase, les Edge Functions, les scripts HP et les firmwares ESP32.

## Vue d'ensemble

L'application est une SPA React/Vite déployée dans deux environnements :

- **Cloud** : frontend public et projet Supabase distant. Il sert à créer les événements, gérer les comptes et paiements, préparer les participants/heats et publier les résultats.
- **Terrain (HP/Event Box)** : le même frontend est servi sur le LAN, devant une stack Supabase auto-hébergée par `infra/docker-compose-local.yml`. Cette stack locale, et non le navigateur du chef juge, est la source de vérité pendant l'événement.
- **Tablettes** : les écrans admin/chef juge, juges, priorité et display ouvrent la SPA du HP et accèdent à son API Supabase locale par REST et Realtime.
- **ESP32 priorité** : le firmware lit l'état de priorité dans Supabase, localement à la plage ou dans le cloud en maintenance, par RPC HTTP et éventuellement par SSE via le proxy VPS.
- **Synchronisation opérateur** : avant l'événement, Cloud -> HP ; après l'événement, HP -> Cloud. Les commandes principales restent `./event-box`, `./beach` et `scripts/hp-ops.sh`.

Le mode terrain peut donc fonctionner sans Internet si le frontend, le HP, le routeur et la stack Supabase locale sont disponibles. Il ne fonctionne pas sans le service Supabase local.

## Composants

### Frontend

- Entrée et routage : `frontend/src/main.tsx`, `App.tsx`, `RootRouter.tsx`.
- Chef juge/admin : `components/AdminInterface.tsx`, `pages/AdminPage.tsx`.
- Juge : `pages/JudgePage.tsx`, `components/JudgeInterface.tsx`, login kiosque par station J1…J5.
- Priorité : `pages/PriorityJudgePage.tsx`, `components/PriorityJudgeLogin.tsx`.
- Affichage/overlay : `pages/DisplayPage.tsx`, `pages/OverlayPage.tsx`.
- État navigateur : stores Zustand et contextes ; certaines données et files sont persistées en IndexedDB avec repli localStorage.
- Accès aux données : coexistence de `api/supabaseClient.ts`, `api/modules/*`, repositories et anciens hooks directs. Cette duplication est une dette structurante.

### Backend courant

Il n'existe pas un serveur métier Node central unique pour le terrain. Le backend critique est Supabase :

- PostgreSQL et fonctions RPC pour l'intégrité, les transitions de heat, les corrections, l'audit et la propagation des qualifiés ;
- PostgREST pour les lectures/écritures ;
- Realtime pour diffuser scores, interférences, heat actif, configuration et timer ;
- Auth/RLS selon le rôle et le mode ;
- Edge Functions pour health-check, sync kiosque/heat et paiements cloud.

`backend/vps-hybrid/` fournit un relais Node/SSE, notamment pour la priorité, mais n'est pas la source de vérité du scoring terrain.

### Infrastructure terrain

`infra/docker-compose-local.yml`, `infra/kong.yml` et les scripts `hp-*` assemblent et exploitent la stack. Le frontend déployé sur le HP pointe vers l'API locale (typiquement `http://192.168.1.2:8000`). Le routeur D-LINK fournit le LAN sans exiger une route Internet.

## Flux chef juge ↔ tablettes

1. Le chef juge sélectionne un événement, un podium et un heat puis affecte un panel permanent J1…J5.
2. L'activation transactionnelle écrit le pointeur de heat actif et recopie les affectations dans `heat_judge_assignments`.
3. Une tablette `/judge?position=Jx&eventId=…&podium=…` charge le heat actif, la configuration, son affectation et le lineup depuis Supabase.
4. Le juge envoie une note identifiée par heat, couleur de lycra, vague, station et identité de juge. `ScoreRepository` persiste dans `scores`, ou place l'intention dans la WAL hors ligne.
5. Realtime diffuse la ligne aux autres clients. En mode plage, un polling de repli lent (30 s) est activé si le WebSocket est dégradé.
6. Chef juge et display recalculent les résultats depuis les notes brutes. Les corrections passent par RPC sécurisée et sont auditées.
7. Les changements de timer/priorité sont écrits dans `heat_realtime_config.config_data` et diffusés de la même manière.

Deux files navigateur coexistent : la WAL `surfJudgingOfflineWAL` pour scores/overrides et la file legacy `surfapp_offline_queue` pour heats/config/timer. `offlineSyncCoordinator.ts` rejoue d'abord la file legacy puis la WAL. Elles protègent une tablette isolée du LAN, mais elles ne remplacent pas la base HP et créent des risques de doublon/ordre lors de reconnexions.

## Scoring actuel

La logique d'affichage/résultat est principalement dans `frontend/src/utils/scoring.ts`.

- Une note accepte actuellement **0 à 10**, avec une décimale (`validateScore`), alors que la future spécification demande un minimum 0,1. La base accepte également 0.
- Les notes sont groupées par couleur normalisée, numéro de vague et station de juge.
- En cas de doublon logique, le calcul trie par timestamp décroissant et conserve la note la plus récente par juge/vague.
- Une vague est officielle seulement si le nombre de stations distinctes égale exactement le panel configuré. `allowIncomplete` existe, mais les résultats normaux l'appellent avec `false`. Fermer le heat ne valide pas une vague partielle.
- **3 juges** : lorsque les trois notes sont présentes, moyenne arithmétique des trois.
- **5 juges** : lorsque les cinq notes sont présentes, tri, suppression d'une valeur minimale et d'une valeur maximale, moyenne des trois restantes.
- Le code applique en réalité le trim à tout `judgeCount >= 5`, puis moyenne toutes les valeurs restantes ; ce comportement au-delà de cinq n'est pas une règle métier documentée.
- Moyennes et totaux sont arrondis à deux décimales.
- Le total sportif est la somme des deux meilleures vagues complètes, avec règles d'interférence INT1/INT2 et disqualification appliquées ensuite.
- Les scores restent attachés à la couleur de lycra. Un override de participant/lineup ne doit pas les déplacer.

Les tests actuels couvrent notamment vagues incomplètes, corrections last-write-wins, interférences et besoins. Ils ne contiennent pas de cas explicite de moyenne nominale à trois juges ni de suppression max/min à cinq juges : le critère P0 « règles confirmées par tests » n'est donc pas encore entièrement satisfait.

## Chronomètre actuel

`useCompetitionTimer.ts` maintient un objet `{isRunning, startTime, duration}` dans le store navigateur. Le chef juge calcule le temps écoulé avec l'horloge du client toutes les 500 ms. Start/pause/reset publient dans `heat_realtime_config` via `useRealtimeSync.ts` et l'RPC `upsert_heat_realtime_config`; les autres écrans reconstruisent leur affichage depuis le timestamp partagé.

- Start mémorise l'heure ISO et la durée restante en minutes.
- Pause remplace la durée par la durée restante et efface `startTime`.
- Reset revient à la durée par défaut et au statut `waiting`.
- À expiration, l'admin publie `paused` avec durée zéro ; l'expiration ne ferme volontairement pas le heat.
- Une copie locale est écrite dans `surfJudgingTimer`, mais l'admin refuse volontairement de la réhydrater : l'état distant/local HP est considéré comme source de vérité.
- En cas de perte réseau, l'écriture timer peut rejoindre la file legacy.

Limites : la source effective du tick et des actions reste le navigateur chef juge, pas un processus serveur autoritaire ; les horloges clientes peuvent diverger ; les états ne correspondent pas exactement aux états cibles READY/RUNNING/PAUSED/FINISHED/CLOSED ; la journalisation complète des événements et l'unicité des alertes 5 minutes/fin ne sont pas garanties par une machine d'état persistée.

## Priorité et ESP32

La tablette `/priority` manipule un `PriorityState` (`equal` ou `ordered`, ordre actif et surfeurs hors lineup) dans `heat_realtime_config.config_data.priorityState`. L'algorithme pur se trouve dans `frontend/src/utils/priority.ts`. Il promeut les suivants lorsqu'un surfeur part et remet le surfeur en queue lors de son retour.

Le firmware `infra/esp32-priority/esp32-priority.ino` :

- possède une URL Supabase cloud codée dans le firmware et une URL locale `http://192.168.1.2:8000` ;
- appelle `get_active_priority` par HTTP avec la clé anon ;
- sait utiliser le cloud en HTTPS ou le HP en HTTP ;
- dispose aussi d'un client SSE vers `/priority/sse?podium=…` et d'un polling de secours ;
- expose une page locale/mDNS `http://priority.local`, de l'OTA et des diagnostics ;
- pilote les modules lumineux par rang/couleur.

L'ESP32 est consommateur : l'app ne lui envoie pas directement une commande. La chaîne est tablette -> Supabase -> RPC/SSE/polling -> ESP32. L'absence de l'ESP32 ne bloque pas le scoring, mais l'état matériel confirmé n'est pas remonté comme preuve métier au chef juge. Les secrets/URLs compilés, le timeout HTTP de 10 s et la coexistence SSE/polling/cloud/local sont des risques.

## Archivage, exports et reprise

- Les faits terrain sont conservés dans PostgreSQL local, puis synchronisés HP -> Cloud par `frontend/scripts/hp-push-db-to-cloud.mjs` piloté par `scripts/hp-ops.sh`.
- `scripts/hp-backup.sh` crée un dump PostgreSQL complet, un SHA-256 et conserve par défaut les 12 derniers snapshots dans `~/surfjudging-backups` sur le HP.
- `heat_history`, `score_overrides`, `score_deletions` et `competition_audit_log` conservent une partie de l'historique métier.
- Le frontend sait produire plusieurs PDF/CSV de structure et résultats. En revanche `utils/exportUtils.ts` est encore un export simulé avec tableaux vides.
- Les files IndexedDB protègent les écritures de tablette non encore acquittées, mais ne constituent pas une archive de compétition.
- Il n'existe pas encore le bundle autonome prévu par la spécification (base + manifest + CSV + JSON + audit JSONL), ni une restauration opérateur testée depuis l'UI.

## Démarrage de référence

- Développement : `npm --prefix frontend install`, puis `npm --prefix frontend run dev` ou `build`.
- Terrain : préparation Cloud -> HP via `./event-box`/`hp-ops.sh`, exploitation via `./beach`, contrôle par `healthcheck`, `competition-check`, `field-smoke` et sauvegarde, puis HP -> Cloud après événement.
- La version de référence doit inclure la version du frontend et la migration attendue exposées dans le panneau diagnostics ; aucun tag/commit P0 n'a été créé par cet audit.
