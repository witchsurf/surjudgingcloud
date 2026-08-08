# Plan de migration — proposition issue de P0

## Garde-fous

Ce plan ne lance ni Electron, ni SQLite, ni réécriture. Toute phase après P0 nécessite validation de l'audit. Le mode HP/LAN, `./event-box`, `./beach`, l'attachement des scores au lycra et le flux Cloud -> HP -> Cloud doivent rester fonctionnels jusqu'à remplacement testé.

## Finir P0 : stabilisation sans changement métier

### Tests de caractérisation à ajouter après validation

- `frontend/src/utils/__tests__/scoring.test.ts` : moyenne exacte à 3 juges, suppression d'une note max/min à 5, égalités max/min, arrondis, deux meilleures vagues, 2/3 et 4/5 notes, correction last-write-wins, limite 12 vagues et note zéro actuelle.
- `frontend/src/utils/__tests__/priority.test.ts` : séquences départ/retour, égalité initiale, ordre à 3/4/5 lycras et invariance multi-podium.
- nouveau test du timer autour de `frontend/src/hooks/useCompetitionTimer.ts`/`useRealtimeSync.ts` : start, pause, reprise, reset, expiration, refresh et perte réseau.
- nouveau test repository/offline : idempotence de `offlineSyncCoordinator.ts`, ordre legacy puis WAL et absence de doublon.
- test lineup : modifier `heat_entries`/participant sans modifier `scores.surfer`.

### Référence exécutable

- Exécuter `npm --prefix frontend test`, `npm --prefix frontend run build` et `bash -n scripts/hp-refresh-stack.sh`.
- Exécuter les smoke tests HP en lecture seule sur la box de référence quand elle est disponible.
- Enregistrer commit, version frontend et `app_runtime_schema_version`; créer la branche de migration seulement avec l'accord du propriétaire.
- Produire un dump vérifié avant toute expérimentation ultérieure.

## Plan fichier par fichier

Les destinations ci-dessous sont proposées, pas créées en P0.

### Contrats métier et calculs

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/utils/scoring.ts` | Figer par tests, puis extraire sans changement dans un module pur partagé ; expliciter 3/5 seulement, arrondi et notes incomplètes | P0 puis P2 |
| `frontend/src/utils/__tests__/scoring.test.ts` | Compléter les tests de caractérisation avant extraction ; réutiliser les mêmes vecteurs contre le nouveau module | P0/P2 |
| `frontend/src/utils/interference.ts` | Extraire avec le scoring pour conserver INT1/INT2/DSQ | P2 |
| `frontend/src/utils/ranking.ts` | Unifier avec la règle de classement et besoins ; supprimer les implémentations parallèles seulement après parité | P2 |
| `frontend/src/utils/priority.ts` | Conserver pur ; ajouter tests, puis le placer derrière un service de priorité | P0/P5 |
| `frontend/src/types/index.ts` | Séparer DTO UI, intentions métier et enregistrements persistés | P2/P3 |

### Accès aux données

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/lib/supabase.ts` | Inventorier tous les appels legacy ; le placer derrière une interface de transport, sans suppression initiale | P1/P2 |
| `frontend/src/api/supabaseClient.ts` | Découper les domaines restants et figer les contrats RPC | P0/P1 |
| `frontend/src/api/modules/*.api.ts` | Faire de ces modules les adaptateurs Supabase de référence pendant la transition | P1/P2 |
| `frontend/src/repositories/*.ts` | Définir interfaces `Event/Heat/Score/TimerRepository`; conserver l'implémentation Supabase, ajouter plus tard une implémentation locale | P1/P2 |
| `frontend/src/types/supabaseDatabase.ts` | Remplacer `any` par des types générés depuis le schéma de référence | P0 |
| `frontend/src/hooks/useSupabaseSync.ts` | Réduire progressivement après déplacement des consommateurs vers repositories | P2/P3 |
| `frontend/src/hooks/useRealtimeSync.ts` | Isoler abonnement et publication derrière un bus temps réel ; conserver le fallback jusqu'aux tests Socket.IO | P3 |
| `frontend/src/lib/sharedRealtimeSubscriptions.ts` | Garder comme comportement de référence pour filtres, partage et diagnostics | P3 |

### État hors ligne et reprise

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/stores/offlineStore.ts` | Formaliser les mutations et clés d'idempotence | P0/P2 |
| `frontend/src/lib/idbOfflineStore.ts` | Conserver comme secours durant la transition ; documenter version et migration | P0/P3 |
| `frontend/src/lib/offlineSyncCoordinator.ts` | Ajouter tests d'ordre/concurrence, puis converger vers une seule file d'intentions | P0/P3 |
| `frontend/src/lib/offlineOperations.ts` | Conserver le journal diagnostics ; relier ultérieurement aux accusés serveur | P3 |
| `frontend/src/stores/scoreWalExecutor.ts` | Tester les retries et doublons avant tout remplacement | P0/P3 |

### Interfaces chef juge, juges et display

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/components/AdminInterface.tsx` | Ne pas réécrire ; extraire progressivement orchestration heat/panel/correction derrière services testés | P1–P5 |
| `frontend/src/pages/JudgePage.tsx` | Remplacer les lectures Supabase directes par services, en conservant URL kiosque et polling de repli | P3 |
| `frontend/src/components/JudgeInterface.tsx` | Conserver UX et invariant lycra ; soumettre une intention idempotente | P2/P3 |
| `frontend/src/pages/DisplayPage.tsx` et `OverlayPage.tsx` | Consommer le même flux de résultats canonique que l'admin | P2/P3 |
| `frontend/src/components/HeatResults.tsx` et `ScoreDisplay.tsx` | Retirer les calculs du composant après parité avec le moteur partagé | P2 |
| `frontend/src/contexts/JudgingContext.tsx`, `stores/judgingStore.ts`, `stores/configStore.ts` | Clarifier état serveur, cache et état UI ; ne pas dupliquer les faits persistés | P2/P3 |
| `frontend/src/RootRouter.tsx` | Conserver routes `/chief`/admin, `/judge`, `/priority`, `/display` lors du futur serveur local | P1 |

### Chronomètre

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/hooks/useCompetitionTimer.ts` | Caractériser l'existant ; à P4, devenir contrôleur UI d'un timer serveur autoritaire | P0/P4 |
| `frontend/src/repositories/TimerRepository.ts` | Étendre le contrat à une machine d'état et événements idempotents | P4 |
| `frontend/src/components/HeatTimer.tsx` | Garder l'affichage, calculer depuis snapshot/temps serveur | P4 |
| `frontend/src/utils/audioUtils.ts` | Tester déclenchement unique 5 minutes/fin ; ne pas en faire la source d'état | P4 |
| tables `heat_realtime_config`, `heat_timers`, `heat_history` | Définir une source canonique et un mapping de reprise avant migration | P4 |

### Priorité et ESP32

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/pages/PriorityJudgePage.tsx` | Conserver UX, envoyer des intentions de priorité journalisées | P5 |
| `backend/supabase/migrations/20260502_esp32_priority_rpc.sql` et variantes podium récentes | Figer le contrat retourné comme protocole de compatibilité | P0/P5 |
| `infra/esp32-priority/esp32-priority.ino` | Externaliser configuration, privilégier adaptateur local, ajouter health/ACK sans bloquer scoring | P5 |
| `backend/vps-hybrid/src/index.ts` | Classer comme relais cloud optionnel ; ne pas l'exiger sur la plage | P5 |
| `docs/priority-judge.md`, `docs/esp32-priority-wiring-memo.md` | Mettre à jour après validation matérielle | P5 |

### Données et backend

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `backend/supabase/migrations/*.sql` | Geler comme historique ; produire un schéma consolidé de référence et dictionnaire, sans réécrire l'historique | P0/P2 |
| `backend/sql/*.sql` | Classer chaque script : runtime HP, diagnostic, réparation ou obsolète ; interdire les réparations dans le chemin normal | P0 |
| `backend/supabase/functions/heat-sync`, `kiosk-bootstrap`, `health-check` | Documenter contrats et décider lesquelles deviennent endpoints locaux | P1/P3 |
| `backend/supabase/functions/payments`, `stripe-webhook` | Maintenir exclusivement dans le module cloud/commercial | P8 |
| futur schéma local | Mapper explicitement toutes les données listées dans `DATA_MODEL_CURRENT.md`, avec validation et rollback | P2 |

### Imports, exports et archivage

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `frontend/src/components/ImportParticipants.tsx`, `utils/csv.ts` | Faire du fichier CSV local le chemin hors ligne ; garder Google Sheet comme option cloud | P1/P8 |
| `frontend/src/utils/pdfExport.ts` | Conserver les exports réellement fonctionnels et ajouter tests de contenu | P7 |
| `frontend/src/utils/exportUtils.ts` | Remplacer l'export simulé par données canonique ou retirer le bouton après validation | P7 |
| `scripts/hp-backup.sh` | Conserver pendant transition ; tester restauration/checksum et copie USB | P0/P7 |
| `frontend/scripts/hp-photocopy-db.mjs` | Geler Cloud -> HP jusqu'au remplacement validé | P0–P7 |
| `frontend/scripts/hp-push-db-to-cloud.mjs` | Geler HP -> Cloud, tester idempotence et conflits | P0–P7 |

### Infrastructure et packaging

| Fichier actuel | Action future proposée | Phase |
|---|---|---|
| `infra/docker-compose-local.yml`, `kong.yml`, `nginx*.conf` | Conserver comme backend terrain de référence jusqu'à parité complète du serveur local | P1–P5 |
| `scripts/hp-ops.sh`, `hp-refresh-stack.sh`, `hp-deploy-frontend.sh` | Préserver CLI et ajouter un backend alternatif seulement derrière commandes explicites | P1–P7 |
| `event-box`, `beach` | Ne pas casser ; maintenir menus et procédures de secours jusqu'à retrait approuvé | Toutes |
| `frontend/vite.config.ts`, `frontend/index.html` | Vérifier assets embarqués, CSP et variables de build terrain | P1 |
| `frontend/src/events/EventsApp.tsx` | Remplacer l'image Unsplash distante pour le build hors ligne | P1 |
| futur Electron/installateur | Ne commencer qu'après validation P0–P5 et serveur local stable | P6 |

## Jalons et critères de passage

1. **P0 validée** : documents approuvés, tests de caractérisation 3/5 et invariant lycra, build/tests verts, référence versionnée, backup vérifié.
2. **P1 serveur local minimal** : uniquement après P0 ; interfaces actuelles accessibles sur LAN sans WAN et sans ressource CDN critique.
3. **P2 données/scoring** : migration réversible, parité bit-à-bit des vecteurs de score, aucune donnée terrain écrasée.
4. **P3 temps réel** : 3 puis 5 tablettes, reconnexion, veille et doublons testés.
5. **P4 timer** : source serveur, reprise et alertes une seule fois.
6. **P5 priorité** : ESP32 présent/absent/lent et simulation testés, sans impact scoring.
7. **P6+** : Electron, packaging, bundle de sauvegarde et commercialisation seulement après ces validations.

## Décisions métier requises avant P2

- La note minimale doit-elle rester 0 ou passer à 0,1 ?
- Arrondit-on chaque moyenne de vague à deux décimales avant le total, comme aujourd'hui ?
- Une vague partielle doit-elle rester invisible/non classante jusqu'à toutes les notes ?
- Que faire d'un panel autre que strictement 3 ou 5 juges ?
- Quel tie-break au-delà de l'égalité du total (aujourd'hui le classement conserve les ex aequo, avec ordre d'affichage lexical) ?

## Vérification de la baseline lors de l'audit

Le 5 août 2026, sans modification du comportement :

- `npm --prefix frontend run test -- --run` : 13 fichiers, 40 tests passés. Vitest a signalé un `EPERM` non bloquant en tentant d'ouvrir son WebSocket HMR sur `0.0.0.0:24678` dans le sandbox ; les tests ont néanmoins terminé avec le code 0.
- `npm --prefix frontend run build` : build Vite/PWA réussi.
- `bash -n scripts/hp-refresh-stack.sh`, `bash -n scripts/hp-ops.sh`, `bash -n event-box` et `bash -n beach` : syntaxe valide.
- Les smoke tests HP et une restauration de dump n'ont pas été lancés : ils nécessitent la box et le réseau terrain de référence.
