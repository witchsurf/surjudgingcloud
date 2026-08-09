# P2.6.6G — Events RLS ownership isolation

Date : 2026-08-09
Projet Cloud : `xwaymumbkmwxqifihuvn`
Migration : `20260808197000_events_rls_ownership_isolation.sql`

## Conclusion courante

`DUAL_MODE_TEST_RELEASE_READY`

La fuite RLS est corrigée. Les preuves DB, PostgREST et la vraie session opérateur sont vertes après refresh : `PostgREST = 12`, `Repository = 12`, `UI = 12`.

`CLOUD_PRODUCTION_PAYMENT_READY = FALSE` demeure inchangé ; Stripe est hors périmètre.

## Inventaire Cloud avant migration

Toutes les policies étaient permissives. PostgreSQL combinait donc leurs expressions avec `OR`.

| Policy | Rôles | Commande | USING / WITH CHECK | Décision |
| --- | --- | --- | --- | --- |
| `Allow anonymous read events` | `anon` | SELECT | `true` | supprimée |
| `Allow public read events` | `anon, authenticated` | SELECT | `true` | supprimée |
| `events_read_own_or_paid` | `public` | SELECT | `owner_id = auth.uid() OR paid = true` | supprimée |
| `events_read_own` | `authenticated` | SELECT | `owner_id = auth.uid()` | remplacée par la règle canonique |
| `events_read_authoritative_field` | `anon, authenticated` | SELECT | mode autoritaire = `field` | préservée |
| `events_insert_own` | `authenticated` | INSERT | `owner_id = auth.uid()` | inchangée |
| `events_update_own` | `authenticated` | UPDATE | `owner_id = auth.uid()` | inchangée |
| `events_delete_own` | `authenticated` | DELETE | `owner_id = auth.uid()` | inchangée |

Le schéma Cloud ne possède aucune colonne `published`, `is_public`, `visibility` ou `publication_status`, ni contrat public dédié identifié. `paid` et `status` restent des états de paiement/workflow et non des marqueurs de publication.

La reconstruction historique a également révélé les anciennes variantes permissives `read_events`, `read_events_basic` et `authenticated_read`. Elles sont explicitement neutralisées par la migration pour garantir la compatibilité des reconstructions PG15/PG17.

## État Cloud après migration

Policies SELECT restantes :

- `events_read_cloud_owner`, rôle `authenticated` : `auth.uid() IS NOT NULL AND (user_id = auth.uid() OR owner_id = auth.uid())` ;
- `events_read_authoritative_field`, rôles `anon, authenticated` : ouverte uniquement si le mode serveur autoritaire vaut `field`.

Les policies INSERT/UPDATE/DELETE n'ont pas été modifiées. RLS reste active. Le mode Cloud contrôlé après application vaut `cloud`. Le stamp `20260808197000` a été inscrit dans `supabase_migrations.schema_migrations` avec le SQL exact appliqué.

## Résultats d'isolation

| Contrôle | Résultat |
| --- | --- |
| HTTP PostgREST anon sur IDs 16 et 43 | 0 ligne — PASS |
| RLS propriétaire opérateur | 12 lignes — PASS |
| Répartition propriétaire | 11 via `user_id`, 1 `owner_id`-only — PASS |
| IDs 16/43 visibles par l'opérateur | 0 — PASS |
| Événements opérateur visibles par le propriétaire étranger de 43 | 0 — PASS |
| Total visible par ce propriétaire étranger | 1 (son propre événement) — PASS |
| Filtre explicite PostgREST de la vraie session avant migration | 12 — PASS |
| Repository/UI de la vraie session après migration | 12 / 12 — PASS |

La preuve utilisateur étranger a utilisé un rôle `authenticated` et des claims de propriétaire réels dans une transaction en lecture seule. Aucun `service_role` n'a servi de preuve RLS et aucune ligne n'a été modifiée.

## Événements 16 et 43

Aucune suppression ni modification n'a été effectuée.

- ID 16, `test off line` : propriétaire défini ; 34 participants, 18 heats, 340 scores, 0 paiement, 1 snapshot.
- ID 43, `P2.6.6C CLOUD TEST ...` : propriétaire défini ; 0 participant, 0 heat, 0 score, 0 paiement, 0 snapshot/config dépendant observé.

Un éventuel nettoyage de 43 doit rester une opération séparée explicitement approuvée.

## Field et compatibilité PostgreSQL

- Reconstruction complète Supabase PostgreSQL 15 : PASS (`150001`, mode final `field`).
- Reconstruction complète Supabase PostgreSQL 17 : PASS (`170006`, mode final `field`).
- Le test accepte les reconstructions historiques dépourvues de `owner_id` sans ajouter de colonne : la policy canonique se replie sur `user_id`.
- E2E Field création/reload/Participants/Admin/sans WAN : PASS sur stack locale temporairement provisionnée `field`.
- Le mode local initial `cloud` a été restauré après le test.

## Régressions

| Test | Résultat |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| Vitest complet | 69 fichiers passés, 6 ignorés ; 400 tests passés, 7 ignorés |
| `npm run build:cloud` | PASS |
| `npm run build:field` | PASS |
| audit réseau P1 Field | PASS, 0 domaine public appelé, routes historiques validées |
| Admin regression | PASS déjà observé avec événement DB 28 après correction du symbole d'interférences |
| E2E Field | PASS après provisionnement autoritaire explicite `field` |

Le premier lancement Vitest a signalé l'impossibilité sandbox d'ouvrir le WebSocket HMR, sans échec de suite. Le premier E2E Field a correctement refusé la création parce que la stack locale était autoritairement en mode `cloud`; après provisionnement temporaire `field`, le scénario est passé puis le mode initial a été restauré.

Les scénarios Cloud CreateEvent/activation test/Competition X précédemment validés n'ont pas été rejoués automatiquement dans ce lot car ils créent des utilisateurs et données Cloud. La migration ne touche que les policies SELECT de `events` et les tests unitaires/contractuels associés restent verts.

## Validation opérateur et freeze

Après refresh de `https://test.surfjudging.cloud/my-events`, la vraie session opérateur a affiché :

- `PostgREST = 12` ;
- `Repository = 12` ;
- `UI = 12` ;
- `user_id = 11`, `owner_id-only = 1`, étrangers = 0.

`EVENTS_VISIBILITY = PASS`. Le diagnostic READ ONLY temporaire et les détails d'erreur réservés au hostname TEST ont été retirés avant le build de freeze. Le freeze P2.6.6 peut reprendre. Aucun déploiement production automatique n'est autorisé par ce rapport.
