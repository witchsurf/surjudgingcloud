# P2.6.6H — Test release freeze

Date : 2026-08-09

## Conclusion courante

`DUAL_MODE_TEST_RELEASE_BLOCKED`

Le commit, les builds et les artefacts sont figés et toutes les validations automatisées sont vertes. Le seul contrôle restant est le smoke manuel de la vraie session Supabase sur le build final effectivement déployé sur `test.surfjudging.cloud` : liste des 12 événements après refresh puis ouverture de `/admin`.

## État produit

- `EVENTS_VISIBILITY = PASS`
- `REAL_SUPABASE_SESSION = PASS` sur le candidat immédiatement antérieur
- `ADMIN_NAVIGATION = PASS` sur le candidat immédiatement antérieur
- `FIELD_READY = TRUE`
- `CLOUD_TEST_READY = TRUE` au niveau code, schéma et tests
- `CLOUD_PRODUCTION_PAYMENT_READY = FALSE`

La release est qualifiée TEST uniquement. Elle n'est pas qualifiée pour le paiement Cloud production.

## Source figée

- commit : `d92c23ab17b2c665c47198a8b1e24baf58d9216b`
- commit court : `d92c23a`
- RELEASE_ID : `surfjudging-2026.08.09-p2.6.6-test-d92c23a`
- branche source : `agent/multi-podium-readiness`
- construction effectuée depuis un worktree détaché au commit exact
- `git diff --check` : PASS
- `SAME_CODE_REVISION = TRUE`
- `MODE_CONFIG_EXPLICIT = TRUE`
- `SCHEMA_COMPATIBLE = TRUE`

Le commit contient les changements approuvés dual-mode, workflow événement, mode autoritaire, création sécurisée, activation Cloud-test, navigation Admin, robustesse Web Storage, isolation RLS et leurs tests/migrations. Les caches CLI Supabase, backups, anciens artefacts, résultats Playwright et builds de travail ne font pas partie du commit.

## Manifests

### Cloud TEST

- `deploymentMode = cloud`
- `releaseId = surfjudging-2026.08.09-p2.6.6-test-d92c23a`
- `codeRevision = d92c23ab17b2c665c47198a8b1e24baf58d9216b`
- `expectedSchemaVersion = 20260808197000_events_rls_ownership_isolation`
- `cloudTestActivationSupported = true`
- `VITE_DEV_MODE` est forcé à `false` par `build:cloud`; OfflineAuth n'est pas activable par ce flag.

### Field TEST

- `deploymentMode = field`
- même RELEASE_ID et même SHA source
- même version de schéma attendue
- `cloudTestActivationSupported = false`
- la route paiement rend `null`/redirige en Field ; Stripe et l'activation Cloud-test ne sont pas utilisables
- audit réseau : aucun appel Supabase Cloud, Google, Stripe, Unsplash ou autre domaine public interdit
- aucun fallback Supabase Cloud autorisé

## Artefacts immuables

| Artefact | Taille | SHA-256 |
| --- | ---: | --- |
| `releases/surfjudging-2026.08.09-p2.6.6-test-d92c23a-cloud.tar.gz` | 1 587 728 octets | `9131de2f1ec1307474e6e50430326bf03eb3093e30fc2daedcdfbfca54751607` |
| `releases/surfjudging-2026.08.09-p2.6.6-test-d92c23a-field.tar.gz` | 1 587 243 octets | `28365c760630a189f08d6cbe72f08ecd29de18cab8e6d332ed47bd02fe51e4c9` |

Les deux archives contiennent un répertoire racine `dist/`, compatible avec l'activation atomique existante.

### Hashes Cloud

| Fichier | SHA-256 |
| --- | --- |
| `index.html` | `089f55ae3473a125d4acc2fe50c2492852cc4b085d18cc95748f109bc1c23ada` |
| `sw.js` | `622a7735259b30379da0f3a2ff59e58ab637afb16fa78fa6d0d8f1b88e13dd02` |
| `assets/xlsxParser-5Yz5tHKO.js` | `a072cbf493c7358eee2c79ad8647b0ecf6d2c10fae3f4dbc5d04cc62332319ba` |
| `deployment-manifest.json` | `ace08d99138fb6df456b2f0701f0549f77668d34fae766c27132334264543eca` |

### Hashes Field

| Fichier | SHA-256 |
| --- | --- |
| `index.html` | `8673c7c67ee5c8c29ebba9e58fd7601380371e85e60880ab24309f326afb1e42` |
| `sw.js` | `62068daf84252457bda7c607da0edbfcf45113a5f0c842225f83b724de58a670` |
| `assets/xlsxParser-CfW9xcvr.js` | `bb2f64c8638c81fc430c70ddfc5c49317e7cf06c653699781b318b4814e01269` |
| `deployment-manifest.json` | `54773925e9ff7da3b47de28c30d4b0ebe04d30b30e6af6f0a65d7c36489311ef` |

## Tests exécutés depuis le commit exact

| Contrôle | Résultat |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| Vitest complet | PASS — 69 fichiers/400 tests ; 6 fichiers/7 tests opt-in ignorés |
| Scoring, WAL, timer, dual-mode, event workflow, Web Storage, Admin | PASS dans la suite complète |
| Build Cloud avec RELEASE_ID/SHA explicites | PASS |
| Build Field avec RELEASE_ID/SHA explicites | PASS |
| Audit réseau P1 Field | PASS — 0 violation, routes historiques PASS |
| Reconstruction Supabase PostgreSQL 15 | PASS — version `150001`, mode final Field |
| Reconstruction Supabase PostgreSQL 17 | PASS — version `170006`, mode final Field |
| Events RLS anon/owner/étranger | PASS |
| Competition X / safe-v2 | tests contractuels PASS ; scénario réel opt-in déjà validé avant freeze |

Le message Vitest relatif au port WebSocket HMR interdit par le sandbox n'a produit aucun échec de test.

## Déploiement TEST final

- branche opérationnelle isolée : `ops-p2-6-6e-temp-frontend`
- commit de transport : `b7db75afe9e062ac0eec8fbf0c851c9099ad38c7`
- GitHub Actions run : `31335536350` — SUCCESS
- URL : `https://test.surfjudging.cloud`
- `/RELEASE_ID` : valeur exacte attendue
- manifeste HTTP : RELEASE_ID, SHA, mode Cloud et version de schéma exacts
- `/admin` TEST : HTTP 200
- `/admin` production : HTTP 200
- `surfjudging.cloud` n'a pas été remplacé

Le diagnostic UI READ ONLY et les détails d'erreur temporaires du hostname TEST ont été retirés du build figé.

## Contrôle manuel restant

Dans la vraie session opérateur sur le build final :

1. recharger `/my-events` et confirmer les 12 événements ;
2. cliquer sur `Continuer` et confirmer l'ouverture de `/admin` avec l'événement DB ;
3. confirmer que l'activation Cloud-test autorisée reste accessible selon le workflow déjà validé.

Après cette preuve, la conclusion deviendra `DUAL_MODE_TEST_RELEASE_READY`. Aucun déploiement production n'est autorisé automatiquement.

## Stripe — risques maintenus

- anomalie de montant `50 000 XOF -> 5 000 000 F CFA` ;
- webhook `verify_jwt=true` ;
- callback non confirmé ;
- `paid=true` jamais confirmé par un paiement Stripe réel.

`CLOUD_PRODUCTION_PAYMENT_READY = FALSE`.
