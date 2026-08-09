# P2.6.6F2 — Operator Admin navigation regression

Date: 2026-08-09
Conclusion: **DUAL_MODE_TEST_RELEASE_BLOCKED**

## Résumé

La navigation Admin est réparée et validée sur le frontend Cloud TEST avec une vraie session opérateur. Le freeze reste toutefois bloqué par une divergence de visibilité Cloud/RLS indépendante : le frontend filtre correctement les événements appartenant à l'opérateur, mais la RLS et le repository non filtré exposent deux événements étrangers.

Aucune donnée Cloud n'a été créée, modifiée ou supprimée pendant ce lot.

## Résultats

| Critère | Résultat |
|---|---|
| REAL_SUPABASE_SESSION | **PASS** |
| ADMIN_NAVIGATION | **PASS** |
| EVENTS_VISIBILITY UI propriétaire | **PASS — 12 événements, 0 étranger** |
| EVENTS_VISIBILITY PostgREST/RLS global | **FAIL — 2 événements étrangers exposés** |
| FIELD_READY | TRUE |
| CLOUD_TEST_READY | TRUE pour le workflow applicatif ; release non qualifiée |
| CLOUD_PRODUCTION_PAYMENT_READY | FALSE |
| MAGIC_LINK_RATE_LIMIT | OPERATIONAL / NON CODE BLOCKER |

## Régression Admin

### Reproduction

Chemin réel validé :

`/my-events` → bouton `Continuer` → `/admin?eventId=28` → chargement DB de `TONTON PAUL TROPHY`.

Le frontend TEST affichait auparavant le fallback Sentry dès le montage d'Admin.

### Classification

`ADMIN_ROUTE_STATE_ERROR` puis `OTHER_CODE_SCOPE_ERROR`.

Deux défauts ont été distingués :

1. `Continuer` écrivait l'ID seulement dans `localStorage` puis naviguait vers `/chief-judge`, sans paramètre canonique. La route cible est maintenant `/admin?eventId=<events.id bigint>`.
2. `AdminInterface` utilisait dans les dépendances d'un `useMemo` l'identifiant inexistant `currentHeatResultInterferences` au lieu de `currentResultInterferences`. Cela produisait immédiatement :

   `ReferenceError: Can't find variable: currentHeatResultInterferences`

### Validation après correction

- Admin ouvert sans Error Boundary ;
- `event_id: 28 · chargé depuis DB` visible ;
- événement, division et podium chargés ;
- absence de heat/panel configuré présentée comme état explicite, sans crash ;
- production `surfjudging.cloud` inchangée.

## Robustesse Web Storage

L'événement Sentry antérieur `Can't find variable: localStorage` venait de l'initialisation du nettoyage du cache et d'accès directs non critiques.

Les accès concernés passent maintenant par un garde `window.localStorage` protégé. L'indisponibilité ou une exception Web Storage :

- ne bascule pas Cloud en mode Offline/Field ;
- n'altère pas l'auth Supabase ;
- ignore uniquement le cache local non critique ;
- ne bloque plus My Events ni l'initialisation Admin.

## Audit READ ONLY des événements

Résultat affiché par le frontend TEST avec la vraie session :

| Mesure | Nombre |
|---|---:|
| POSTGREST_COUNT avec filtre `user_id OR owner_id` | 12 |
| UI_COUNT | 12 |
| événements `user_id` opérateur | 11 |
| événements `owner_id-only` opérateur | 1 |
| étrangers affichés par l'UI | 0 |
| REPOSITORY_COUNT sans filtre explicite | 14 |
| RLS_VISIBLE_COUNT | 14 |

Événements RLS/repository hors ownership opérateur :

| event_id | nom | paid | status | PostgREST/RLS | filtre ownership/UI |
|---:|---|---|---|---|---|
| 16 | `test off line` | false | pending | visible | exclu |
| 43 | `P2.6.6C CLOUD TEST 1786297876877-cadf3f` | false | pending | visible | exclu |

Le contrôle anonyme PostgREST confirme également la lecture de ces deux lignes non payées. Le filtre frontend empêche leur affichage, mais il ne remplace pas une isolation RLS correcte.

## Explication du nombre historique 13

Le rapport P2.6.4 comptait 13 lignes totales dans le backup Cloud, et non 13 événements appartenant nécessairement à la session opérateur actuelle. Cet inventaire contenait déjà l'ID 16.

Depuis, l'ID 43 a été ajouté comme événement temporaire P2.6.6C, portant le total RLS visible à 14. L'inventaire propriétaire actuel est de 12 : 11 par `user_id` et 1 par `owner_id-only`.

L'ID 43 n'a pas été supprimé : toute suppression nécessite une autorisation opérateur explicite et un lot de cleanup séparé.

## Cause RLS caractérisée

Le backup de schéma Cloud pré-170 contient notamment :

- `Allow anonymous read events` pour `anon` avec `USING (true)` ;
- `Allow public read events` pour `authenticated`, `anon` avec `USING (true)`.

Ces policies permissives rendent sans effet d'isolation les policies plus restrictives, car les policies PostgreSQL permissives sont combinées par `OR`. Le comportement PostgREST actuel prouve qu'une lecture publique équivalente est toujours active.

Aucune policy et aucune migration SQL n'ont été modifiées dans P2.6.6F2.

## Tests et validations exécutés

- tests ciblés Admin/scoring, event workflow et storage : **36/36 PASS** ;
- typecheck `tsc --noEmit` : **PASS** ;
- build Cloud : **PASS** ;
- déploiement isolé `test.surfjudging.cloud` : **PASS** ;
- production HTTP : **200, inchangée** ;
- validation opérateur réelle Admin : **PASS** ;
- audit PostgREST/repository/UI : **FAIL RLS**, détails ci-dessus.

## Blocage et suite requise

Avant freeze, un lot SQL séparé doit :

1. inventorier les policies Cloud actives de `public.events` ;
2. retirer uniquement les policies de lecture `USING (true)` non désirées ;
3. définir explicitement la règle produit pour les événements payés/publics ;
4. préserver la lecture propriétaire `user_id OR owner_id` ;
5. revalider anon, authenticated propriétaire et authenticated étranger ;
6. décider séparément du cleanup de l'événement temporaire 43.

Tant que la RLS expose les IDs 16 et 43 à une session non propriétaire, `EVENTS_VISIBILITY` ne peut pas être déclaré PASS et aucun freeze de release ne doit commencer.
