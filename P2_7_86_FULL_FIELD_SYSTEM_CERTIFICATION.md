# P2.7.86 — Full Field System Regression Battery

## Environment gate

- FIELD_HOST: `10.0.0.10` (served manifest reachable over HTTP)
- Release: `surfjudging-2026.08.14-p2.7.78-lineage-fix`
- Served revision: `17ed8b0799a9a0298b7d6b7812f57403432b093d`
- Repository HEAD: `17ed8b0799a9a0298b7d6b7812f57403432b093d`
- Browser session: CONNECTED; Playwright: YES; Admin/Judge/Display tabs: YES
- Runtime source identity: MATCH (manifest and HEAD)
- Worktree: NOT CLEAN (historical reports, generated dist-field, and prior edits are present; untouched)
- `git ls-remote origin main` could not resolve `github.com` in this sandbox;
  remote parity was not independently rechecked.

## Automated battery

- Frontend Vitest: **PASS** — 91 files, 481 passed, 7 skipped (488 total).
- Focused selector, draft/save, realtime, Display, Judge, scoring, ranking,
  qualification, readiness and lineage/cardinality contracts were included.
- One non-failing test-run warning: Vite WebSocket listen was denied by the
  sandbox; tests themselves completed successfully.
- DB permanent regression A–K: **NOT EXECUTED**. The required command failed
  before PostgreSQL execution: `permission denied while trying to connect to
  the Docker API at unix:///Users/rene/.colima/default/docker.sock`.

## Read-only field safety snapshot

- Podium A: `mamelles_open_cadet_r1_h1`, status open, runtime running.
- Podium B: `mamelles_open_cadet_r2_h2`, status open, runtime waiting.
- A/R1H1 has exactly three RED/V1 scores (6.5, 7.0, 7.5) with the three
  certified judge identities; four materialized entries and three assignments.
- No score, pointer, heat status, assignment, or qualification mutation was
  performed by this battery.

## Resume execution

- Colima was confirmed running with the existing `colima` Docker context; no
  permissions were weakened. `docker ps` succeeded.
- Permanent DB regression A–K: **PASS** (`p2_7_75_permanent_db_regression.sql`,
  synthetic event 90775, transaction rolled back).
- Exhaustive ranking regression: **PASS** (`p2_7_72_exhaustive_ranking.sql`,
  transaction rolled back).
- TypeScript: **PASS** using the repository-local compiler
  (`frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit`).
- Field build: **PASS**. This generated/updated the existing untracked
  `frontend/dist-field/`; it was not deployed.
- The initial `npm exec tsc` form attempted registry access and is not used as
  evidence; the local compiler result above is authoritative.
- Passive Playwright soak: **PASS** — all nine existing Admin/Judge/Display
  tabs remained connected for 60 seconds; pointers and the three A scores were
  unchanged.

## Remaining gate

The DB and automated gates now pass. Existing certified evidence covers the
live start, scoring, realtime, close, ranking and recovery paths; no new live
mutation was performed in this resume. Field restart and offline/LAN
disruption were intentionally not exercised because Podium A is a live heat;
those destructive/availability tests require an explicit safe window.

**CURRENT VERDICT: PARTIALLY CERTIFIED — AUTOMATED BATTERY PASS; LIVE FULL-BATTERY SOAK PENDING.**

## Normal live workflow (resume)

- Added test-owned panels through the real Judge UI only; no existing score was
  overwritten. RED/V1 remained 6.50/7.00/7.50; BLANC/V1 = 6.00/6.50/6.70;
  RED/V2 = 5.50/6.00/6.50; BLANC/V2 = 5.50/6.00/6.50.
- All 12 rows persisted with the expected J1/J2/J3 identities. B remained at
  `mamelles_open_cadet_r2_h2` with zero scores.
- Best-two ranking: RED 13.00, BLANC 12.40, untouched YELLOW/BLUE 0.
- Admin and Display converged without reload; readiness changed to
  `can_close=true`, blockers empty.

## R1H1 close

- One normal UI close action; confirmation accepted once.
- DB immediately confirmed `R1H1 = closed`; all 12 scores remained intact and
  B remained unchanged. Admin rendered the canonical closed/result state.
- R2H1 blockers: R1H3 and R1H4 not closed. R2H2 blockers: R1H3 and R1H4 not
  closed. No R2 start was attempted.

## Architecture / deployment read-only audit

- Cloud and Field modes both exist in `deploymentMode` and `supabase.ts`;
  endpoint/key selection is mode-specific. Sporting API/scoring/ranking paths
  are shared. Field-only offline/WAL and LAN network helpers are isolated.
- Active pointers, START validation, CLOSE and ranking are shared RPC/API
  contracts; Cloud test activation is service-role/cloud-gated. No Field→Cloud
  hard-coded endpoint was found in the inspected paths.
- `.github/workflows/deploy.yml` is the deployment entry point (push/workflow
  dispatch); no Cloud deployment was performed or inferred here. GitHub parity
  was not rechecked because DNS is unavailable in the sandbox.

## Infrastructure remaining

- Field restart: **NOT RUN — a heat was running during the test window**.
- Offline/LAN disruption: **NOT RUN — safe window required**.
- Safe window: **NO**.

**FINAL VERDICT: PARTIALLY CERTIFIED — NORMAL SCORING, BEST-TWO, REALTIME,
READINESS, SINGLE CLOSE, QUALIFICATION GATES AND ISOLATION PASS; restart/offline
infrastructure gates remain intentionally pending.**

## Final infrastructure gates

- Safe-window DB check: **YES** — no `heat_realtime_config.status=running`;
  A/R1H1 was closed and B/R2H2 waiting.
- Immutable pre-restart baseline: pointers A/R1H1 and B/R2H2, all event-10
  statuses, scores (including the 12 A/R1H1 test rows), and six interference
  rows recorded.
- Application-only restart: **PASS**. Target `surfjudging` only; Postgres,
  PostgREST, Realtime and Auth were not restarted. Restart began 18:54:35Z,
  manifest became reachable 18:54:37Z (about 2 s).
- Manifest after: same release `p2.7.78-lineage-fix`, revision `17ed8b0`, and
  expected schema. DB pointers/statuses/scores/interferences were unchanged.
- Client recovery: **PASS**. Existing Admin, three Judge A, Display A,
  three Judge B and Display B clients hydrated/reconnected without manual
  reload; closed A and waiting B were rendered correctly.
- Final normal-network soak: **PASS**, 60 seconds; no pointer rollback or
  database mutation observed.
- Offline/LAN: **PASS — controlled browser-only public-origin interruption**.
  Playwright routes on all nine existing Field tabs aborted every non-Field
  origin with `internetdisconnected`, while `10.0.0.10:8080` and
  `10.0.0.10:8000` remained allowed. `https://example.com` failed with
  `TypeError: Failed to fetch`; Field manifest and REST API both returned HTTP
  200. During the interruption Admin remained synchronized, Judge A remained
  on closed R1H1, Judge B remained on waiting R2H2, and both Displays stayed
  hydrated. No save/start/close/score action occurred. Routes were removed and
  public fetch recovered (opaque status 0); Field manifest/API remained 200.
  A final 60-second soak showed unchanged pointers, heat statuses, 206 scores,
  six interferences, and unchanged runtime-config statuses.
- Cloud modified: **NO**.

**FIELD RESTART = PASS**
**OFFLINE/LAN = PASS (browser-controlled public-origin loss; LAN preserved)**
**FIELD SYSTEM CERTIFIED = YES**
**DESKTOP APP WORKSTREAM AUTHORIZED = YES**

### P2.7.86 final gate evidence

- Browser session: **CONNECTED**; Chrome/CDP and Playwright: **YES**.
- Admin tab: `http://10.0.0.10:8080/admin?eventId=10` (existing session reused).
- Mechanism: reversible Playwright request interception only; no host firewall,
  Wi-Fi, Docker network, database, source, build or deployment changes.
- Baseline and final DB identity: A=`mamelles_open_cadet_r1_h1`,
  B=`mamelles_open_cadet_r2_h2`; A closed, B waiting; scores 206;
  interferences 6. No active/running heat was present.
