# P2_7_15_CHIEF_JUDGE_SCORE_CORRECTION_REPORT

## A. Starting Mamelles state

Date: August 11, 2026

Scope:

- Event: `MAMELLES OPEN`
- `event_id = 10`
- Division: `JUNIOR`
- Round 1 Heat 1
- `heat_id = mamelles_open_junior_r1_h1`
- `heat.status = open`

State preserved before patch:

- all existing scores remained
- all existing interference calls remained
- source score for correction test existed:
  - `CHARLES / ROUGE / V3 / 4.00`
- destination was absent:
  - `JAUNE / V4`
- existing interference remained:
  - `JAUNE / V2 / INT1 majority 2/3`

Nothing was cleaned.
The heat was not closed.

## B. randomUUID root cause

Live browser runtime check on the actual LAN app:

- URL: `http://192.168.1.41:8080/admin?eventId=10`
- `protocol = http:`
- `isSecureContext = false`
- `crypto = present`
- `crypto.randomUUID = absent`
- `crypto.getRandomValues = present`

Exact cause:

- the Field browser runtime is an insecure HTTP context
- in that context, the browser does not expose `crypto.randomUUID()`
- however, Web Crypto random bytes are still available through `crypto.getRandomValues()`

So the failure was caused by a frontend runtime assumption:

```text
assumed: randomUUID always exists if crypto exists
actual field runtime: crypto exists, randomUUID absent, getRandomValues available
```

This was confirmed in the real browser, not inferred.

## C. Existing UUID utilities

Before the patch, there was no single canonical UUID helper for the field runtime.

Direct or ad hoc UUID generation existed in multiple places, including:

- [frontend/src/components/AdminInterface.tsx](/Users/rene/Desktop/judging%202/frontend/src/components/AdminInterface.tsx)
- [frontend/src/repositories/BaseRepository.ts](/Users/rene/Desktop/judging%202/frontend/src/repositories/BaseRepository.ts)
- [frontend/src/hooks/useSupabaseSync.ts](/Users/rene/Desktop/judging%202/frontend/src/hooks/useSupabaseSync.ts)
- [frontend/src/lib/offlineOperations.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/offlineOperations.ts)
- [frontend/src/stores/offlineStore.ts](/Users/rene/Desktop/judging%202/frontend/src/stores/offlineStore.ts)

Important production move-path usage:

- `AdminInterface.handleMoveScore()` created `override_log.id` with direct `crypto.randomUUID()`

Backend/Edge usage also exists in:

- `backend/supabase/functions/health-check/index.ts`

That backend usage was not changed because it is not the failing field browser path.

## D. Tests before patch

Failing characterization tests were added before the compatibility patch:

- [frontend/src/lib/__tests__/uuid.compat.test.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/__tests__/uuid.compat.test.ts)
- [frontend/src/components/__tests__/AdminInterface.moveUuid.contract.test.ts](/Users/rene/Desktop/judging%202/frontend/src/components/__tests__/AdminInterface.moveUuid.contract.test.ts)

Initial failing results:

- shared UUID helper import failed because no helper existed yet
- `AdminInterface` still contained direct `crypto.randomUUID()`
- `AdminInterface` did not yet call a shared helper

These failing tests characterized the exact defect before patch.

## E. UUID correction

New canonical helper added:

- [frontend/src/lib/uuid.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/uuid.ts)

Behavior:

- secure/modern path:
  - `crypto.randomUUID()`
- field HTTP compatibility path:
  - standards-compliant UUID v4 generated from `crypto.getRandomValues()`
- no `Math.random()`
- no `Date.now()` ID synthesis
- valid UUID v4 format preserved

Patched frontend call sites:

- [frontend/src/components/AdminInterface.tsx](/Users/rene/Desktop/judging%202/frontend/src/components/AdminInterface.tsx)
- [frontend/src/repositories/BaseRepository.ts](/Users/rene/Desktop/judging%202/frontend/src/repositories/BaseRepository.ts)
- [frontend/src/hooks/useSupabaseSync.ts](/Users/rene/Desktop/judging%202/frontend/src/hooks/useSupabaseSync.ts)
- [frontend/src/lib/offlineOperations.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/offlineOperations.ts)
- [frontend/src/stores/offlineStore.ts](/Users/rene/Desktop/judging%202/frontend/src/stores/offlineStore.ts)

Critical move-path correction:

```text
Admin move override_log.id
from direct crypto.randomUUID()
to shared generateUuidV4()
```

## F. Tests after patch

Validated on August 11, 2026:

- `npx tsc --noEmit` ✅
- `bash -n scripts/hp-refresh-stack.sh` ✅
- targeted UUID/frontend tests ✅

Targeted passing test run:

```text
npm --prefix frontend test -- --run \
  src/lib/__tests__/uuid.compat.test.ts \
  src/components/__tests__/AdminInterface.moveUuid.contract.test.ts
```

Passing coverage achieved:

- randomUUID available → valid UUID returned
- crypto exists but randomUUID unavailable → valid UUID still returned
- UUID format contract preserved
- Admin move path no longer depends on direct `crypto.randomUUID()`
- modern browser path remains unchanged

## G. score_overrides ACL/RLS audit

### Table / chronology schema

`score_overrides` stores override chronology, including:

- `id uuid`
- `heat_id`
- `score_id`
- `judge_station`
- `judge_identity_id`
- `surfer`
- `wave_number`
- `previous_score`
- `new_score`
- `reason`
- `comment`
- `overridden_by`
- `overridden_by_name`
- `created_at`

### Current authorization evidence

Live browser behavior:

- direct Admin `GET /rest/v1/score_overrides?...` returns `401`
- browser logs include:
  - `permission denied for table score_overrides`
  - code `42501`

Live DB policy/grant audit:

- table grants visible to ordinary runtime roles were not broad public table privileges
- RLS policies currently include both legacy/public and later restricted policies
- active policy set in the database includes:
  - `public can read score_overrides`
  - `score_overrides_read_accessible`
  - `score_overrides_insert_owners`
  - plus authenticated read/insert/update/delete policies present in the local DB

Observed effect in practice:

- direct anon browser read is still denied on this field instance

### Authorization matrix observed / inferred from runtime + migrations

| Role | SELECT score_overrides | INSERT score_overrides | UPDATE | DELETE | RPC correction |
|---|---:|---:|---:|---:|---:|
| anon | runtime read failed (`401/42501`) | not used by frontend directly | not used | not used | `apply_score_correction_secure` executable |
| authenticated | restricted by owner/heat policies | restricted by owner policies | authenticated policy present locally | authenticated policy present locally | executable |
| service_role | effectively unrestricted operationally | effectively unrestricted operationally | effectively unrestricted operationally | effectively unrestricted operationally | executable |

Important conclusion:

- direct table read failure is real
- but the secure correction RPC path itself is not blocked by that read failure

## H. Correction RPC security analysis

Secure correction architecture confirmed from migrations:

- `record_score_override_secure(...)`
  - `SECURITY DEFINER`
- `apply_score_correction_secure(...)`
  - `SECURITY DEFINER`

Local-field compatibility logic also confirmed:

- in local DB mode, authentication requirement is relaxed:
  - `if not public.is_local_database() and auth.uid() is null then raise ...`

This means:

- the intended secure architecture is RPC-first
- frontend does not need broad anonymous table writes to move a score
- the move RPC updates the score and writes chronology internally

This is exactly what happened in the successful retest.

## I. Deployment

Validation/build:

- `npx tsc --noEmit` ✅
- `bash -n scripts/hp-refresh-stack.sh` ✅
- targeted tests ✅
- `SURFJUDGING_RELEASE_ID=surfjudging-2026.08.11-p2.7.15-chief-judge-move npm --prefix frontend run build:field` ✅

Field deployment performed on the local Mac runtime with:

- backup of previous `releases/mac-runtime/current/dist/`
- rsync of `frontend/dist-field/`
- `docker restart surfjudging`

Served manifest after deploy:

```json
{
  "deploymentMode": "field",
  "releaseId": "surfjudging-2026.08.11-p2.7.15-chief-judge-move",
  "codeRevision": "977128bc23f8ba6ddc13515e1c3d5a3f0bac377c",
  "expectedSchemaVersion": "20260811090000_allow_field_anon_runtime_heat_config",
  "cloudTestActivationSupported": false
}
```

Served JS bundle confirmed:

- `/assets/index-nGH4ioIx.js`

Service worker/cache:

- field build regenerated normally
- no stale bundle evidence in the retest session

## J. Live Admin move attempt

Retest target:

- heat: `mamelles_open_junior_r1_h1`
- source:
  - `CHARLES`
  - `ROUGE`
  - `V3`
  - `4.00`
- destination:
  - `JAUNE`
  - `V4`

Real Admin action:

- `Déplacer la note sélectionnée`

Live result after P2.7.15:

```text
Note déplacée vers JAUNE · Vague 4.
```

The previous `crypto.randomUUID is not a function` error disappeared.

## K. Network trace

Observed network behavior during the successful retest:

- `POST /rest/v1/rpc/apply_score_correction_secure` → `200`
- repeated direct `GET /rest/v1/score_overrides?...` → `401`
- `GET /rest/v1/scores?...` remained `200`

This proves:

- correction write path succeeded through the secure RPC
- chronology direct read path remained broken independently

Primary artifact:

- [artifacts/p2_7_14_override_only/run.json](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_override_only/run.json)

## L. DB before/after

### Before

- source present:
  - `ROUGE / V3 / 4.00`
- destination absent:
  - `JAUNE / V4`

### After

Canonical scores in DB after the successful move:

- `ROUGE / V3` → absent
- `JAUNE / V4 / 4.00` → present

Preserved judge identity:

- `judge_station = J1`
- `judge_identity_id = 5164895e-51e9-42f2-9583-80a3e36cc435`

Preserved canonical context:

- `heat_id = mamelles_open_junior_r1_h1`
- `event_id = 10`

Chronology row written in `score_overrides`:

- `id = fb91944a-cc08-4c14-8c2c-ecd97235b6d6`
- `score_id = 00000000-0000-4000-915e-019ff31a9cbf`
- `surfer = JAUNE`
- `wave_number = 4`
- `previous_score = 4.00`
- `new_score = 4.00`
- `reason = correction`
- `overridden_by = chief_judge`

Canonical contract result:

- source removed/inactive: `YES`
- destination present: `YES`
- two active copies: `NO`

## M. Admin result

Admin after successful move:

- ROUGE now shows only `V1:7.50 V2:6.50`
- JAUNE now shows:
  - `V1:5.50`
  - `V2:2.50`
  - `V3:0.00*`
  - `V4:4.00*`
- move success message visible:
  - `Note déplacée vers JAUNE · Vague 4.`
- `Status Actuel : OPEN`
- no false `HEAT DÉJÀ JUGÉ`

Important scoring interpretation:

- JAUNE V4 is incomplete because only one judge score exists there
- therefore it remains excluded from best-two total
- JAUNE total stays `8.00`

## N. Display result

Display did not reflect the canonical score state correctly after refresh.

Observed on refreshed `/display`:

- scores displayed as `0.00`
- interference label still visible on JAUNE V2
- moved score not shown canonically

This differs from:

- Admin canonical state
- DB canonical state

So the move mechanism itself is certified, but Display remains inconsistent in this scenario.

Artifacts:

- [artifacts/p2_7_15_display_refresh.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_15_display_refresh.png)

## O. Interference regression check

Existing interference survived the correction intact.

DB evidence after move:

- J1 / `JAUNE / V2 / INT1`
- J2 / `JAUNE / V2 / INT1`

Admin still applied the penalty:

- JAUNE V2 remained `2.50`

So the score move did not corrupt or delete `interference_calls`.

## P. Heat lifecycle check

Confirmed after the successful correction:

- `heat.status = open`
- no automatic closure
- no `HEAT DÉJÀ JUGÉ`
- `FERMER LE HEAT` was not clicked

## Q. score_overrides remaining issue

Current exact situation:

- correction/move path works through `apply_score_correction_secure`
- chronology write succeeds in DB
- Admin direct read of `score_overrides` still fails with `401/42501`

This matches outcome:

```text
C) Secure RPC writes chronology successfully, but frontend direct SELECT fails.
```

Therefore:

- do NOT broaden anonymous table writes
- do NOT broaden anonymous table reads blindly
- the remaining defect is an audit/read-path problem, not a correction-path blocker

## R. Files modified

Files modified for P2.7.15:

- [frontend/src/lib/uuid.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/uuid.ts)
- [frontend/src/lib/__tests__/uuid.compat.test.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/__tests__/uuid.compat.test.ts)
- [frontend/src/components/__tests__/AdminInterface.moveUuid.contract.test.ts](/Users/rene/Desktop/judging%202/frontend/src/components/__tests__/AdminInterface.moveUuid.contract.test.ts)
- [frontend/src/components/AdminInterface.tsx](/Users/rene/Desktop/judging%202/frontend/src/components/AdminInterface.tsx)
- [frontend/src/repositories/BaseRepository.ts](/Users/rene/Desktop/judging%202/frontend/src/repositories/BaseRepository.ts)
- [frontend/src/hooks/useSupabaseSync.ts](/Users/rene/Desktop/judging%202/frontend/src/hooks/useSupabaseSync.ts)
- [frontend/src/lib/offlineOperations.ts](/Users/rene/Desktop/judging%202/frontend/src/lib/offlineOperations.ts)
- [frontend/src/stores/offlineStore.ts](/Users/rene/Desktop/judging%202/frontend/src/stores/offlineStore.ts)

Supporting field test scripts used:

- [scripts/p2_7_14_admin_override_only.mjs](/Users/rene/Desktop/judging%202/scripts/p2_7_14_admin_override_only.mjs)

## S. Mamelles preserved state

Preserved intentionally:

- all existing R1 H1 scores
- moved correction result
- all interference calls
- assignments
- entries
- configuration
- ranking
- heat open status

Not done:

- no cleanup
- no restore
- no heat close
- no continuation to R1 H2
- no continuation to Final

## T. Recommended next action

Recommended next chantier:

1. fix the Display canonical read/render regression for this corrected heat state
2. design the narrowest correct read mechanism for override chronology in field mode
   - likely RPC/view-mediated read, not broad anon table access
3. keep the exact `ROUGE V3 → BLEU V4` test deferred until a legitimate 4-surfer heat/final containing BLUE

## FINAL VERDICT

```text
CHIEF JUDGE SCORE CORRECTION PARTIALLY CERTIFIED
```

Why partial:

- the Chief Judge move/correction mechanism itself is now certified in field mode
- the UUID blocker is fixed
- the secure RPC move succeeded live on Mamelles
- the chronology row was written successfully
- the interference survived
- the heat remained open

But:

- direct `score_overrides` read still fails in field Admin
- Display remained inconsistent with canonical DB/Admin state after the move
