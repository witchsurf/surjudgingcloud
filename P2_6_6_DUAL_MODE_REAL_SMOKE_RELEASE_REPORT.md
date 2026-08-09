# P2.6.6 — Dual-mode real smoke + release

Date : 2026-08-09
Conclusion : **DUAL_MODE_RELEASE_BLOCKED**

## Décision

Aucun commit release, RELEASE_ID, artefact final ou déploiement n'a été créé. Le premier smoke réel de création d'événement Field échoue sur la frontière d'autorisation PostgreSQL/Supabase. Continuer vers Cloud ou figer une release aurait masqué un défaut bloquant.

## A — Freeze du code

Les changements P2.6.5 inventoriés concernent uniquement :

- le contrat `DeploymentMode = cloud | field` ;
- le workflow événement et l'ID DB canonique ;
- la séparation auth/paiement/synchronisation Cloud et Field ;
- les composants création, paiement, participants, planning et liste d'événements ;
- les builds/manifests Cloud et Field ;
- l'audit réseau Field.

P2.6.6 n'a modifié ni scoring, WAL score/override, timer, planning safety, migrations SQL ou ACL. Les changements ACL/migrations déjà présents dans le worktree sont antérieurs et n'ont pas été inclus dans un commit P2.6.6.

Un test E2E de caractérisation a été ajouté :

- `frontend/e2e/p2-6-6-field-event.spec.ts`.

## B — Stack Field isolée

Isolation formellement vérifiée via les métadonnées Docker :

| Stack | Projet Compose/Supabase | Réseau | Volume DB | Usage |
|---|---|---|---|---|
| test | `backend` | `supabase_network_backend` | `supabase_db_backend` | P2.6.6 |
| Event Box active | `infra` | `infra_surfjudging_network` | `infra_postgres-data` | non touchée |

La stack test utilise :

- API `127.0.0.1:54321` ;
- PostgreSQL `127.0.0.1:54322` ;
- son propre volume ;
- zéro événement avant test.

Elle a été reconstruite depuis les migrations courantes jusqu'à `20260808180000`, puis redémarrée sans suppression de volume. La stack Event Box `infra` n'a jamais été arrêtée, réinitialisée ou mutée.

## C — Smoke Field création événement

Fixture attendue : `P2.6.6 FIELD TEST`.

Le navigateur Playwright a été exécuté avec :

- `VITE_DEPLOYMENT_MODE=field` ;
- Supabase local isolé ;
- interception et refus de toute requête dont l'hôte n'est ni `localhost` ni `127.0.0.1`.

### Essai 1 — comportement P2.6.5

Résultat : échec avant INSERT.

```text
permission denied for table events
```

La page est restée sur `/create-event`; aucun pseudo-ID et aucune redirection `/payment` n'ont été produits.

### Caractérisation de la session locale

Une session Supabase anonyme locale a été testée temporairement afin de distinguer absence de JWT et droits DB. Elle a bien fourni un rôle `authenticated`, sans Cloud ni WAN, mais l'INSERT a encore échoué avec le même message.

Cette expérimentation a ensuite été entièrement retirée du code et de la configuration, car elle ne résout pas le défaut et n'était pas approuvée comme changement produit.

### Cause prouvée

Les policies RLS `events` existent pour `authenticated`, notamment `authenticated_insert`, mais les privilèges de table sont absents :

```text
grantee postgres: SELECT/INSERT/UPDATE/DELETE/...
grantee authenticated: aucun privilège
grantee anon: aucun privilège
```

PostgreSQL vérifie d'abord le privilège de table, avant la policy RLS. Une vraie session locale ne peut donc pas exécuter l'INSERT.

Classification : **FIELD_CREATE_EVENT_BLOCKED_BY_EVENTS_ACL**.

Corriger ce point exige une décision séparée, car P2.6.6 interdit explicitement toute modification ACL.

## D — Competition X et safe v2

Les tests réels existants ont été rejoués contre la stack isolée avec le fichier fourni :

`/Users/rene/Library/CloudStorage/Dropbox/DTN/COMPETITION/Competition X.xlsx`

Commande logique : tests opt-in `PlanningImportPanel.persistence.realCompetitionX` et `realHeatPlanning.integration`.

Résultats :

- 2 fichiers de tests réussis ;
- 3 tests réussis ;
- fichier réel parsé : 62 participants, 7 catégories ;
- preview et preflight `SAFE` ;
- RPC safe v2 réelle ;
- heats, entries, mappings et configs persistés ;
- `is_active = false` ;
- blocage concurrent protecteur vérifié sans perte de score ;
- fixtures automatiquement nettoyées.

Limite : ces tests préparent l'événement fixture par SQL authentifié de test. Ils prouvent le planning safe v2 une fois l'événement présent, mais ne contournent pas le blocage du workflow UI de création.

## E — Restart/persistence Field

La stack isolée a été arrêtée et redémarrée plusieurs fois avec volume conservé. Le schéma est resté disponible.

Le scénario utilisateur complet « créer événement → importer → restart → recharger Admin » n'a pas pu être terminé, car la création UI est bloquée avant l'INSERT. Aucun résultat partiel n'est présenté comme validation.

## F — Négatifs Field

- WAN : toutes les requêtes publiques étaient interceptées et bloquées pendant le test navigateur.
- Aucun appel Stripe, Supabase Cloud ou Google observé avant le blocage.
- Pseudo-ID texte : toujours refusé par les 19 tests P2.6.5.
- Événement non persisté : écriture des heats toujours bloquée.
- `VITE_DEV_MODE` ne modifie pas `DeploymentMode`.
- L'audit réseau P1 de l'artefact Field P2.6.5 reste vert, mais aucun artefact P2.6.6 final n'a été produit.

## G — Cleanup Field

Nettoyage final vérifié sur la stack isolée :

```text
fixture_events       = 0
fixture_participants = 0
fixture_heats        = 0
anonymous_test_users = 0
```

Quatre utilisateurs anonymes générés pendant la caractérisation ont été supprimés. Aucun élément de l'Event Box active n'a été touché.

## H à M — Cloud

Non exécuté.

Motif : le smoke Field obligatoire a échoué avant le freeze release. Les instructions imposent deux workflows réellement verts avant commit et release. Aucun événement Cloud, paiement, fixture non payée ou événement existant n'a été modifié.

Par conséquent :

- paiement/callback : non validé P2.6.6 ;
- visibilité des 13 événements existants : non revalidée P2.6.6 ;
- ownership `owner_id-only` : non revalidé P2.6.6 ;
- création Cloud : non tentée ;
- cleanup Cloud : sans objet.

## N à P — Commit, release et manifests

Non exécutés conformément au STOP :

- commit SHA P2.6.6 : **NON CRÉÉ** ;
- RELEASE_ID : **NON CRÉÉ** ;
- manifest Cloud P2.6.6 : **NON CRÉÉ** ;
- manifest Field P2.6.6 : **NON CRÉÉ** ;
- hashes d'artefacts P2.6.6 : **NON CRÉÉS**.

Les anciens `dist-cloud` et `dist-field` P2.6.5 restent des artefacts de revue non immuables et ne doivent pas être renommés en release P2.6.6.

## Q — Tests release

Il n'existe pas de commit/release P2.6.6 à qualifier. Aucun faux résultat de suite « release » n'est donc déclaré.

Validations effectivement exécutées avant STOP :

- typecheck après diagnostic : réussi ;
- Competition X réel + safe v2 : 3/3 réussis ;
- smoke navigateur Field : échoue de manière reproductible sur `permission denied for table events` ;
- cleanup : réussi.

## R — Plan de déploiement

Aucun déploiement automatique ou manuel n'est autorisé depuis cet état.

Le plan reste inchangé après correction et revalidation :

- GitHub/Cloud doit recevoir uniquement `dist-cloud` ;
- Event Box Mac/Windows doit recevoir uniquement `dist-field` ;
- les deux artefacts doivent provenir du même commit final et porter des manifests explicites.

## Décision nécessaire

P2.6.6 ne peut reprendre qu'après approbation d'un sous-lot dédié à la frontière de création d'événement. Deux solutions doivent être arbitrées :

1. restaurer les privilèges minimaux `SELECT`/`INSERT` nécessaires à `authenticated` sur `events` et la séquence associée, en s'appuyant sur les policies RLS existantes ;
2. créer une RPC `create_event_secure` atomique et faire passer les deux modes par cette façade, sans réouvrir les écritures directes de table.

La seconde option offre une frontière plus explicite et contrôlable, mais constitue une migration SQL et un changement d'adaptateur. Dans les deux cas, il faut également formaliser l'identité opérateur **locale** Field, distincte de toute auth Cloud, et la compatibilité du schéma local sans colonne `owner_id`.

Jusqu'à cette décision :

```text
SAME_CODE_REVISION = NOT_ESTABLISHED_FOR_P2_6_6
SCHEMA_COMPATIBLE = NOT_PROVEN_FOR_EVENT_CREATION
MODE_CONFIG_EXPLICIT = TRUE
DUAL_MODE_RELEASE_BLOCKED
```
