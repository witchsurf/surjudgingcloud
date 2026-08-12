# SURFJUDGING — FIX REPORT `heat_judge_assignments`

Périmètre autorisé respecté : `frontend/src/pages/AdminPage.tsx`, `frontend/src/repositories/HeatRepository.ts` + fichiers de tests. Aucune migration / RLS / RPC / scoring / planning / WAL / PWA / multi-podium modifié.

---

## 1. Tests AVANT patch

- **Test A** (AdminPage.handleConfigSaved, erreur invisible) : **FAIL attendu, confirmé FAIL.**
  Preuve avant patch — les 4 variantes échouaient avec :
  `AssertionError: promise resolved "undefined" instead of rejecting`
  (23503, 42501, PGRST202, et createHeat-échec). Le `catch` avalait l'erreur → `configSaved` restait `true` → faux « SAUVEGARDÉE ».

- **Test B** (event_id null → 0) : **FAIL attendu, confirmé FAIL.**
  Preuve avant patch :
  `AssertionError: expected +0 to be null` dans `HeatRepository.assignments.test.ts`.
  `Number(null) === 0` → `event_id: 0` inséré → violation FK `heat_judge_assignments_event_id_fkey` (events(id) ne contient pas 0).

- **Test C** (happy path event 10) : **PASS** (référence de bon comportement).
- **Test D** (RPC throw → repository rejette, aucune étape suivante) : **PASS** (le repository rejette déjà correctement ; ce test le verrouille).

## 2. Modifications

### `frontend/src/pages/AdminPage.tsx` — `handleConfigSaved`
- **Ancien** : tout code d'erreur autre que `23514`/`23505` était avalé par `console.log('⚠️ Heat créé en mode local uniquement', error)` et `persistConfig(config)` continuait → faux succès UI. `publishConfigUpdate` était dans le même `try` que la persistance critique.
- **Nouveau** : séparation persistance critique / publication secondaire.
  - `createHeat` + `saveHeatConfig` (critique) : si l'un throw → `setConfigSaved(false)`, log structuré `{heatId, podiumId, code, message}`, puis `throw error` (remonte à `AdminInterface.handleSaveConfig` qui affiche l'alerte). Pas de double alerte.
  - `publishConfigUpdate` déplacé dans son propre `try/catch` : un échec realtime ne fait plus croire à un échec DB.

### `frontend/src/repositories/HeatRepository.ts` — `buildJudgeAssignments`
- **Ancien** : `const eventId = Number.isFinite(Number(config?.event_id)) ? Number(config.event_id) : null;` → `null` devenait `0`.
- **Nouveau** :
  ```ts
  const rawEventId: unknown = config?.event_id;
  const eventId =
      rawEventId == null || rawEventId === ''
          ? null
          : Number.isFinite(Number(rawEventId))
              ? Number(rawEventId)
              : null;
  ```
  `null`/`undefined`/`''` → `null` ; nombre valide → nombre ; invalide → `null`. Aucune valeur codée en dur.

## 3. Diff résumé
- AdminPage.tsx : bloc `catch` réécrit (plus de whitelist `23514/23505`), `throw` systématique sur échec de persistance critique, `publishConfigUpdate` isolé.
- HeatRepository.ts : normalisation `event_id` sans coercition `null→0`.
- 2 fichiers de tests ajoutés (caractérisation avant correctif).

## 4. Tests APRÈS patch
- Tests ciblés (A×4, B, C, D) : **PASS (7/7).**
- Suite complète : **74 fichiers passés, 434 tests passés, 7 skipped, 0 échec.**
- TypeScript : **0 nouvelle erreur** dans les fichiers touchés (total projet 223 erreurs pré-existantes hors périmètre, inchangées ici).
- Lint : total projet identique avant/après (aucun nouveau dans les fichiers touchés).
- Build `build:field` : **PASS** (`✓ built`).

## 5. Validation chaîne (niveau code + tests)
```
Admin Save                 PASS (erreur remontée si échec)
createHeat                 PASS (throw → configSaved=false)
saveHeatConfig             PASS (throw → configSaved=false)
upsert_heat_config_runtime PASS (appelé 1×, Test C)
heat_judge_assignments     PASS (upsert 1×, 3 lignes exactes, Test C)
heat_entries               PASS (ensureHeatEntries appelé, Test C)
event snapshot (podium A)  PASS (Test C)
UI success                 PASS (seulement si persistance OK)
```

## 6. Event ID
```
null remains null                    PASS (Test B après patch)
event 10 remains 10                  PASS (Test C)
no event_id=0 accidental coercion    PASS (Test B)
```

## 7. Error propagation
```
23503 visible                                PASS (Test A)
42501 visible                                PASS (Test A)
PGRST202 visible                             PASS (Test A)
configSaved=false on persistence failure     PASS (Test A)
```

## 8. Runtime DB (vérifié sur la stack Field locale, mode=field)
- `heat_configs` pour `mamelles_open_benjamin_r1_h1` : `judges={J1,J2,J3}`, `judge_names={}` (vide).
- `heat_judge_assignments` : 0 ligne.
- `scores` : présents, valides, avec `judge_identity_id` officiels (J1→5164895e…, J2→442df135…).

Cohérence heat_configs ↔ heat_judge_assignments : **FAIL** (juges déclarés dans heat_configs mais aucune affectation) — exactement le symptôme terrain. Aucune donnée réelle définitivement modifiée (ligne de test insérée puis supprimée, `judge_names` restauré à `{}`).

## 9. Déclencheur historique

**CONFIRMÉ par preuve runtime** (pas seulement probable) :

> Le RPC `upsert_heat_config_runtime` n'a **pas** le grant `EXECUTE` pour le rôle `anon`.

Preuves :
- `proacl = {postgres=X,authenticated=X,service_role=X}` → `anon` absent.
- Tous les autres RPCs terrain (`upsert_score_secure`, `activate_heat_on_podium`, `close_heat_on_podium`, `record_score_override_secure`, `set_podium_judge_panel`…) **ont** le grant `anon`.
- `curl` en `anon` sur la DB Field → `HTTP 401 {"code":"42501","message":"permission denied for function upsert_heat_config_runtime"}`.
- `curl` en `service_role` → `HTTP 204` (succès).
- `curl` upsert direct `anon` dans `heat_judge_assignments` → `HTTP 201` (la table accepte anon — grants/RLS table OK, comme déjà innocents).

Chaîne du bug :
1. Admin Field hors-ligne = rôle `anon` (pas de session Supabase authentifiée).
2. `saveHeatConfig` appelle d'abord `upsertRuntimeHeatConfig` → RPC `upsert_heat_config_runtime` → **42501** (grant EXECUTE manquant pour anon).
3. Le RPC throw AVANT d'écrire `heat_configs` et AVANT l'upsert `heat_judge_assignments` → 0 affectation.
4. Ancien `catch` AdminPage avalait 42501 (≠ 23514/23505) → `configSaved=true` → faux « SAUVEGARDÉE ».
5. `heat_configs.judges={J1,J2,J3}` présent vient d'une autre voie (planning/copie podium), d'où le cockpit « 0 JUGES / 0 AFFECTATION(S) » alors que la config semblait exister.

**Conclusion :** le `Number(null)→0` (corrigé) et le swallow (corrigé) sont de vrais bugs, mais le **déclencheur terrain dominant** est le **grant EXECUTE manquant pour `anon`** sur `upsert_heat_config_runtime`. La migration `20260808170000_finalize_heat_configs_acl.sql` a explicitement `revoke execute … from anon`, ce qui casse le mode Field hors-ligne (le contournement `is_local_database()` dans le corps du RPC ne sert pas, car PostgreSQL refuse l'EXECUTE avant d'évaluer le corps).

## 10. Fichiers modifiés
- `frontend/src/pages/AdminPage.tsx`
- `frontend/src/repositories/HeatRepository.ts`
- `frontend/src/pages/__tests__/AdminPage.configSave.test.tsx` (nouveau)
- `frontend/src/repositories/__tests__/HeatRepository.assignments.test.ts` (nouveau)

## 11. Hors périmètre — non modifié (confirmé)
Aucune modification : migrations, RLS, ACL, RPC `upsert_heat_config_runtime`, scoring, heat engine, planning, WAL, PWA, multi-podium, ESP32, realtime.

## 12. ⚠️ Changement hors périmètre REQUIS (non appliqué — à approuver)

**Le correctif frontend seul ne suffit pas à obtenir 3/3 sur le terrain.** Mes deux correctifs rendent l'échec **visible** (plus de faux succès) et corrigent le piège `event_id=0`, mais le RPC restera refusé à `anon` tant que le grant manque.

**Action requise (migration, à valider par vous) :**
```sql
grant execute on function public.upsert_heat_config_runtime(text, text[], text[], jsonb, integer, text) to anon;
```
(aligne ce RPC sur tous les autres RPCs terrain qui ont déjà le grant anon). Alternative : exiger une session authentifiée en mode Field. **Sans l'une de ces deux actions, BENJAMIN R1 H1 restera à 0/3 en mode hors-ligne.**

Recommandation : ouvrir un chantier séparé « grant RPC terrain » avec backup DB + test runtime avant/après, puis rejouer le scénario complet Admin → 3 affectations visibles.

