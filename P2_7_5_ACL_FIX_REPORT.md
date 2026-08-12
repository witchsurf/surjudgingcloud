# SURFJUDGING — P2.7.5 ACL FIX REPORT

## A. Root cause

Confirmé : `anon` n'avait pas la permission `EXECUTE` sur `public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)`.

- `20260808150000_runtime_heat_config_rpc.sql` a créé le RPC, révoqué `PUBLIC`, puis accordé seulement `authenticated` et `service_role`.
- `20260808170000_finalize_heat_configs_acl.sql` a explicitement révoqué un ancien grant direct `anon`. Le commentaire montre que la révocation était volontaire pour réduire les écritures navigateur historiques, mais elle ne tenait pas compte du fait que le navigateur Field utilise `anon`.
- `20260808180000_reconcile_heat_configs_acl_pg15_pg17.sql` a répété cette révocation pour réconcilier PostgreSQL 15 Field et PostgreSQL 17 Cloud.
- Aucune migration ultérieure ne rétablissait `anon` avant P2.7.5.
- Les autres RPC Field comparés accordent explicitement `anon` : `upsert_score_secure`, `set_podium_judge_panel`, `activate_heat_on_podium` et `close_heat_on_podium`.

## B. Security assessment

```text
RPC: public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)
SECURITY DEFINER/INVOKER: SECURITY DEFINER, owner postgres
search_path: public
local DB guard: is_local_database()
event access guard: user_has_event_access(v_event_id) hors DB locale, sauf service_role
risk after anon grant: limité au modèle Field local ; hors local anon entre dans le RPC mais reçoit 42501
verdict: GRANT EXECUTE TO anon acceptable dans le modèle Surfjudging actuel
```

Le RPC valide un `p_heat_id` non vide, résout le heat réel dans `public.heats`, récupère son `event_id`, refuse un heat absent, puis applique le contrôle local/événement avant l'écriture. Il ne modifie que `public.heat_configs`, via paramètres typés et sans SQL dynamique. Il retourne `void`, donc aucun secret. Un identifiant arbitraire ne permet pas de contourner l'isolation événement hors local.

Note de durcissement hors périmètre : `search_path = public` est fixe mais moins strict que `public, pg_temp`. Aucun changement du corps n'était nécessaire pour ce correctif ACL minimal.

## C. Migration créée

Nom exact :

```text
20260811090000_allow_field_anon_runtime_heat_config.sql
```

Contenu : transaction contenant uniquement `GRANT EXECUTE` sur la signature exacte du RPC au rôle `anon`. Aucun droit table, schéma ou autre RPC n'est modifié. `GRANT` est idempotent.

## D. ACL avant

```text
anon: absent
authenticated: EXECUTE
service_role: EXECUTE
```

Preuve runtime PostgreSQL 15 Field :

```text
{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

La cible a été identifiée avant mutation : DB `postgres`, PostgreSQL `15.1`, mode autoritatif `field`. Une sauvegarde du schéma `public` a été créée dans le conteneur : `/tmp/p2_7_5_before_acl_fix_public.dump` (375577 octets). Le dump global a été refusé par les ACL internes `_realtime`, d'où le dump ciblé des données applicatives `public`.

## E. Test RPC avant

```text
anon → HTTP 401, PostgreSQL 42501, permission denied for function upsert_heat_config_runtime
service_role → HTTP 204 (preuve runtime déjà établie dans P2.7.4)
```

Le test `anon` P2.7.5 a utilisé uniquement `p2_7_5_acl_test_heat`, événement local de test 11.

## F. ACL après

```text
anon: EXECUTE
authenticated: EXECUTE
service_role: EXECUTE
```

Preuve runtime :

```text
{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,anon=X/postgres}
```

## G. Test RPC après

```text
anon → HTTP 204
```

Le même endpoint, la même clé anon et le même payload ont été utilisés avant et après migration.

## H. End-to-end Field test

Test isolé via API Field réelle sur `p2_7_5_acl_test_heat` : RPC anon, upsert anon `heat_judge_assignments`, puis upsert anon `heat_entries`. Les tests frontend valident en plus l'ordre de la chaîne repository et le succès UI conditionnel.

```text
heat_configs: PASS — judges={J1,J2,J3}, judge_names contient les 3 clés
heat_judge_assignments: 3/3
heat_entries: 3/3
event_id: PASS — 11 sur les 3 lignes
judge UUID: PASS — 3 UUID officiels distincts
judge names: PASS — J1MAIMOUNA, JKHADIJA, CHARLES
UI: NOT TESTABLE en interaction réelle — aucune instance du navigateur intégré disponible
```

Le contrat UI reste couvert par `AdminPage.configSave.test.tsx` et le chemin complet repository par `HeatRepository.assignments.test.ts`. Aucune donnée BENJAMIN n'a été utilisée ou modifiée.

## I. Security negative test

```text
unauthorized non-local access: DENIED
is_local_database(): false
résultat: ERROR Access denied for heat p2_7_5_acl_test_heat (42501 dans le RPC)
```

Le `GRANT EXECUTE` autorise donc l'entrée dans la fonction ; la fonction conserve son contrôle métier hors local.

## J. Existing tests

```text
AdminPage.configSave: PASS — 4/4
HeatRepository.assignments: PASS — 3/3
HeatRepository ciblés: PASS — 15/15 au total
build:field: PASS
full suite: PASS — 74 fichiers, 434 tests ; 7 tests ignorés
bash -n scripts/hp-refresh-stack.sh: PASS
typecheck: PASS — exit 0 dans l'état actuel du dépôt
```

Vitest a affiché un avertissement WebSocket `listen EPERM 0.0.0.0:24678` lié au bac à sable, sans empêcher l'exécution ni changer le résultat des tests.

## K. `judge_names={}` diagnostic

Le RPC n'efface pas intrinsèquement `judge_names` : il stocke exactement `coalesce(p_judge_names, '{}'::jsonb)` et met cette valeur à jour lors d'un conflit. L'état Benjamin `{}` est donc un état historique provenant d'un appel antérieur avec payload vide ou d'une autre voie de création/configuration, pas une conséquence de l'ACL et pas une transformation cachée du RPC.

La source d'identité officielle actuelle est `heat_judge_assignments` (`judge_id`, `judge_name`), tandis que `heat_configs.judge_names` reste un snapshot de compatibilité/runtime. `{}` peut être toléré lorsque les affectations officielles existent, mais Benjamin avait précisément 0 affectation : dans ce cas, il s'agissait d'un état historique incomplet distinct. Aucune correction de données n'a été faite dans ce chantier.

## L. Files modified

- `backend/supabase/migrations/20260811090000_allow_field_anon_runtime_heat_config.sql`
- `P2_7_5_ACL_FIX_REPORT.md`

Les fichiers frontend Cline ont seulement été lus/testés, jamais réécrits.

## M. Out of scope

Confirmé : aucune modification du scoring, heat engine, planning, WAL, PWA, ESP32, multi-podium, Realtime, des correctifs frontend Cline, des tables/RLS ou d'autres ACL.

Les données temporaires `P2.7.5 ACL TEST` ont été supprimées après capture des preuves. La sauvegarde pré-patch reste disponible dans le conteneur local.
