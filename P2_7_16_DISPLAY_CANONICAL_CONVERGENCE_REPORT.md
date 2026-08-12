# P2.7.16 — Display canonical score convergence

## A. Starting state

- Event: `MAMELLES OPEN`
- `event_id = 10`
- Division: `JUNIOR`
- Heat: `mamelles_open_junior_r1_h1`
- `heat.status = open`
- Existing Mamelles state preserved:
  - canonical moved score already present: `J1 / YELLOW / V4 / 4.00`
  - `ROUGE V3` absent
  - majority interference preserved: `JAUNE / V2 / INT1`
  - Admin canonical totals before patch:
    - RED `14.00`
    - WHITE `12.50`
    - YELLOW `8.00`

## B. Display data-flow trace

Observed cold-load chain on real browser probe:

`/display?eventId=10&podium=A`
→ `ConfigStore.initializeFromUrl`
→ `loadConfigFromDb(eventId=10)`
→ current heat resolves to `mamelles_open_junior_r1_h1`
→ `loadScoresFromDatabase(currentHeatId)`
→ `ScoreRepository.fetchScores()` returns 19 canonical scores
→ hydration normalization throws
→ hook catch returns `[]`
→ Display renders zero scores

## C. Canonical DB score set

Real probe evidence showed Display local storage cache containing 19 canonical rows for:

- `RED` V1/J1..J3, V2/J1..J3
- `WHITE` V1/J1..J3, V2/J1..J3
- `YELLOW` V1/J1..J3, V2/J1..J3, V4/J1

Judge identities were correct for all cached rows.

## D. Network requests

Fresh Display context used the canonical heat id:

- `GET /rest/v1/scores?select=*&heat_id=eq.mamelles_open_junior_r1_h1&order=created_at.asc`
- `GET /rest/v1/heat_entries?...heat_id=eq.mamelles_open_junior_r1_h1`
- `GET /rest/v1/v_heat_lineup?...heat_id=eq.mamelles_open_junior_r1_h1`
- `GET /rest/v1/heat_realtime_config?...heat_id=eq.mamelles_open_junior_r1_h1`

No stale short heat id was used for the score fetch.

## E. First divergence identified

First actual divergence was inside `useSupabaseSync.loadScoresFromDatabase()` after the repository fetch succeeded.

Exact runtime error from fresh Display probe:

`isValidUuid is not defined`

Because the hook catches the error and returns `[]`, Display received an empty score array.

## F. Root cause

`frontend/src/hooks/useSupabaseSync.ts` imported `isUuidV4` but called the nonexistent identifier `isValidUuid` during score hydration normalization.

So the real sequence was:

- repository fetch succeeds with 19 canonical scores
- normalization throws `ReferenceError`
- catch path logs warning and returns empty array
- Display scoring engine receives no scores
- interferences still load separately
- UI shows `INT1` but all totals stay `0.00`

This is a read/hydration bug, not a DB bug and not a scoring-engine bug.

## G. Tests before patch

Real browser probe before patch reproduced:

- Admin: canonical result correct
- Display: all totals `0.00`
- Display local storage: 19 canonical scores present
- probe logs:
  - `Scores fetched online {count: 19}`
  - `Scores non chargés depuis Supabase (mode local): isValidUuid is not defined`

## H. Source changes

Changed:

- `frontend/src/hooks/useSupabaseSync.ts`
  - replaced bad identifier `isValidUuid` with imported `isUuidV4`
  - exported normalization helper as `normalizePersistedScores`

Added:

- `frontend/src/hooks/__tests__/useSupabaseSync.test.ts`

## I. Tests after patch

Passed:

- `npm --prefix frontend test -- --run src/hooks/__tests__/useSupabaseSync.test.ts src/pages/__tests__/DisplayPage.p2.test.tsx src/domain/scoring/__tests__/engine.parity.test.ts`
- `npx tsc --noEmit` from `frontend/`
- `bash -n scripts/hp-refresh-stack.sh`

New targeted assertions:

- valid UUID ids remain unchanged during hydration
- invalid ids are repaired only through supplied generator

## J. Build/deployment

Built field bundle successfully.

Active local build artifact:

- `frontend/dist-field/assets/DisplayPage-BA9utERA.js`

Prepared runtime release id:

- `surfjudging-2026.08.11-p2.7.16-display-convergence`

Deployment step completed:

- copied `frontend/dist-field/` into `releases/mac-runtime/current/dist/`
- preserved previous dist backup:
  - `releases/mac-runtime/backups/dist-before-p2.7.16-display-convergence-20260811-2344/`

## K. Fresh Display load

Fresh Playwright Display probe before patch confirmed the defect.

Fresh live certification after deployment could not be completed because local field runtime `:8080` was no longer reachable on this machine at the end of the session and Docker restart/start actions were unavailable from the execution layer.

## L. Admin vs Display comparison

Before patch, same heat side-by-side:

- Admin showed canonical result:
  - RED `14.00`
  - WHITE `12.50`
  - YELLOW `8.00`
- Display showed:
  - RED `0.00`
  - WHITE `0.00`
  - YELLOW `0.00`
  - `INT1` still visible on YELLOW

This matched the identified hydration failure.

## M. Refresh test

Pre-patch refresh/cold-load failed consistently on Display.

Post-patch refresh could not be live-certified because runtime serving on `:8080` was unavailable at the final step.

## N. Cold-start test

Completed before patch and reproduced the defect.

Post-fix cold-start live certification pending runtime availability.

## O. Interference verification

No interference semantics were changed.

Expected canonical interpretation remains:

- YELLOW V1 `5.50`
- YELLOW V2 `2.50` after `INT1`
- YELLOW V4 `4.00` incomplete
- YELLOW total `8.00`

## P. Corrected score verification

No new score writes were made.

No new move, override, interference, or heat close was performed.

Existing correction preserved:

- source `ROUGE V3` absent
- destination `YELLOW V4 = 4.00`

## Q. Heat lifecycle

No lifecycle mutation performed.

Heat remained intended target:

- `mamelles_open_junior_r1_h1`
- status expected to remain `open`

## R. score_overrides 401 status

Not fixed in this task by design.

Prior known issue remains separate:

- direct `score_overrides` read can still fail
- this must not block canonical current score display

## S. Files modified

- `frontend/src/hooks/useSupabaseSync.ts`
- `frontend/src/hooks/__tests__/useSupabaseSync.test.ts`
- `frontend/dist-field/RELEASE_ID`
- `frontend/dist-field/deployment-manifest.json`

## T. Mamelles preserved state

Preserved:

- all scores
- all judge assignments
- all heat entries
- all current rankings
- interference calls
- chief-judge move result
- no event cleanup
- no backup restore
- no heat closure
- no R1 H2 continuation

## FINAL VERDICT

DISPLAY CANONICAL CONVERGENCE PARTIALLY CERTIFIED

Reason:

- root cause identified with exact runtime error
- minimal source fix implemented
- targeted tests + typecheck + field build passed
- Mamelles data preserved
- final live browser certification on the newly deployed runtime remains pending because local field serving on `:8080` was unavailable and Docker restart/start could not be executed from the current execution layer.
