# SURFJUDGING — P2.7.9 — FIELD SAVE ALIGNMENT + DEPLOYMENT

Date de certification : 2026-08-11 (Africa/Dakar)
Release Field : `surfjudging-2026.08.11-p2.7.9-977128b-field`
URL certifiée : `http://192.168.1.41:8080/admin?eventId=10`
Contexte : `MAMELLES OPEN → JUNIOR → R1 H1`, podium A, event 10.

## A. Tests écrits avant correction

- Première phase rouge : 7 échecs sur 11 tests ciblés. Elle a démontré le faux succès prématuré, l'absence de validation du heat planifié, les appels historiques `events`/création de heat et l'absence du marqueur local de succès.
- Rafraîchissement : un test rouge supplémentaire a reproduit la divergence `RED/WHITE/YELLOW` ↔ `ROUGE/BLANC/JAUNE`, y compris les clés dupliquées des dictionnaires noms/pays.
- Les scénarios d'échec contrôlés couvrent notamment `23503`, `42501`, `PGRST202` et erreur réseau : aucun ne doit laisser `configSaved=true`.

## B. Alignement frontend réalisé

- `AdminPage` attend désormais la fin de la persistance canonique avant de publier le succès.
- `AdminInterface` attend réellement la promesse du parent et n'écrit le marqueur local de succès qu'après résolution.
- La comparaison de rafraîchissement normalise les alias de lycra pour la liste, les noms et les pays, sans relâcher la comparaison des juges ou du reste de la configuration.

## C. Suppression des écritures événement historiques

Le SAVE Admin ne fait plus d'upsert direct dans `events`, n'appelle plus `ensureEventExists` et ne sauvegarde plus un snapshot événement avant la chaîne canonique. Aucune requête `PATCH events` n'a été observée pendant le SAVE réel.

## D. Heat planifié

Le heat doit déjà exister. Sa metadata est relue et validée contre event/division/round/heat. Une absence ou incohérence arrête le SAVE avec une erreur explicite. Le frontend ne crée et n'upsert pas le heat planifié.

## E. Chemin canonique certifié

Ordre observé lors de l'unique SAVE réel :

1. lecture metadata du heat ;
2. `POST /rpc/upsert_heat_config_runtime` — 204 ;
3. upsert `heat_judge_assignments` — 201 ;
4. lecture/garantie des `heat_entries` ;
5. `POST /rpc/upsert_event_last_config` — 204 pour le podium A.

Aucun upsert direct de `heat_configs`, `heats` ou `events` n'a été observé.

## F. Sémantique `configSaved`

- `false` avant et pendant la persistance critique ;
- `true` seulement après succès complet ;
- reste `false` et remonte l'erreur si une étape critique échoue ;
- après rafraîchissement, les alias de couleurs et leurs dictionnaires ne produisent plus un faux état dirty.

## G. Validation automatisée finale

- Tests ciblés SAVE : 12/12 passés sur 3 fichiers.
- Suite complète finale : 75 fichiers passés, 6 ignorés ; 439 tests passés, 7 ignorés (446 au total).
- `npx tsc --noEmit` : succès.
- `bash -n scripts/hp-refresh-stack.sh` : succès.
- `bash -n scripts/hp-deploy-frontend.sh` : succès.
- Le warning websocket Vitest `listen EPERM :24678`, les warnings React `act()` des tests d'erreur et les fallbacks IndexedDB de jsdom sont non bloquants ; le processus retourne 0.

## H. Build Field

- Commande : `SURFJUDGING_RELEASE_ID=surfjudging-2026.08.11-p2.7.9-977128b-field npm run build:field`.
- 2461 modules transformés ; build final en 7,44 s.
- PWA : 47 entrées précachées générées.
- Bundles finaux : `assets/index-B6yqL01m.js`, `assets/AdminPage-BE4Hu410.js`.
- `RELEASE_ID` et `deployment-manifest.json` portent la release attendue.

## I. Déploiement Mac Field

- Sauvegarde du runtime précédent : `releases/mac-runtime/backups/dist-before-p2.7.9-refresh-alias-20260811-2132/`.
- Synchronisation atomique du contenu `frontend/dist-field/` vers `releases/mac-runtime/current/dist/` avec suppression des artefacts obsolètes.
- Redémarrage du conteneur frontend `surfjudging` réussi.
- Aucune migration, modification ACL/RLS/RPC ou suppression de données.

## J. Bundle réellement servi

Playwright a relu depuis l'origine LAN :

- titre `Surf Judging System` ;
- `RELEASE_ID = surfjudging-2026.08.11-p2.7.9-977128b-field` ;
- mode manifest `field` ;
- révision `977128bc23f8ba6ddc13515e1c3d5a3f0bac377c` ;
- script principal réellement chargé : `http://192.168.1.41:8080/assets/index-B6yqL01m.js`.

Le bundle servi contient le chemin RPC canonique et ne contient pas l'ancien upsert direct de `heat_configs`.

## K. Cache et service worker

Sur l'origine LAN certifiée : zéro enregistrement service worker et zéro cache Cache Storage. Le navigateur a chargé les hashes finaux. Le cache n'est donc pas un contributeur au résultat.

## L. Unique SAVE Mamelles

Un seul clic SAVE réel a été effectué, sur `MAMELLES OPEN → JUNIOR → R1 H1`. Trace utile : metadata 200, RPC runtime 204, affectations 201, entrées 200, snapshot événement 204. L'UI est passée à `SAUVEGARDÉE`, et une capture a été conservée dans `p2-7-9-field-save-certified.png`.

Aucun score n'a été saisi et aucun second SAVE n'a été effectué pendant les corrections de rafraîchissement.

## M. État DB contrôlé après SAVE

- Heat `mamelles_open_junior_r1_h1`, event 10, statut `open`.
- `created_at` et `updated_at` du heat inchangés ; `heat_size=3`; ordre `RED, WHITE, YELLOW`.
- Configuration : juges J1/J2/J3, 15 vagues, élimination.
- Affectations exactes : CHARLES (`5164895e-51e9-42f2-9583-80a3e36cc435`), J1MAIMOUNA (`442df135-52cb-4037-895f-5a174de825ca`), JKHADIJA (`c724401b-46ba-4b3e-8227-d8c46110eb2e`).
- Entrées exactes : RED Babacar Sene, WHITE Mouhamed Diawara, YELLOW Buye Assane Gueye.
- Nombre de scores : 0.

La tentative de relire une seconde fois la DB après le dernier redéploiement frontend a été bloquée par l'expiration du contrôle d'autorisation Docker. Le redéploiement n'a exécuté que `rsync` du frontend et `docker restart surfjudging`; il ne comporte aucune écriture DB.

## N. Rafraîchissement certifié

Après navigation fraîche et attente de l'hydratation :

- Zustand `configSaved=true` et marqueur historique `surfJudgingConfigSaved=true` ;
- bouton `SAUVEGARDÉE` désactivé ;
- JUNIOR, Round 1, Heat 1 ;
- CHARLES, J1MAIMOUNA, JKHADIJA ;
- Babacar Sene, Mouhamed Diawara, Buye Assane Gueye.

Ce contrôle n'a déclenché aucun SAVE.

## O. Fichiers de la correction P2.7.9

- `frontend/src/pages/AdminPage.tsx`
- `frontend/src/components/AdminInterface.tsx`
- `frontend/src/pages/__tests__/AdminPage.configSave.test.tsx`
- `frontend/src/components/__tests__/AdminInterface.configSave.contract.test.ts`
- `frontend/dist-field/RELEASE_ID` et artefacts de build générés
- `P2_7_9_FIELD_SAVE_ALIGNMENT_REPORT.md`

Le dépôt contenait déjà d'autres modifications et artefacts non liés ; ils n'ont pas été nettoyés ni écrasés.

## P. Préservation des données

Toutes les données Mamelles ont été conservées. Aucun nettoyage, reset, delete ou écrasement de scores n'a été effectué. Le heat reste `open` et contient zéro score.

## Q. Points non bloquants hors périmètre

- La lecture `score_overrides` retourne encore 401/permission denied et active le fallback existant. Cette question ACL/RLS était explicitement hors périmètre P2.7.9.
- Les diagnostics de santé peuvent sonder l'adresse HP par défaut `10.0.0.14` alors que l'app LAN certifiée fonctionne sur `192.168.1.41`; cela n'a pas bloqué le SAVE canonique.

## R. Verdict

**FIELD SAVE CERTIFIED**

Le SAVE Admin Field utilise le chemin canonique, ne crée ni ne réécrit event/heat, ne déclare le succès qu'après la chaîne critique, et conserve correctement son état après rafraîchissement. Les données Mamelles et les scores ont été préservés.
