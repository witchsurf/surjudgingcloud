# P2.7.58 — Admin reload hydration convergence

## Evidence before patch

- FIELD_HOST: `10.0.0.10` (verified by served manifest)
- Baseline release: `surfjudging-2026.08.14-p2.7.57-unsaved-pointer-fix-3f94494`
- Baseline served revision: `3f94494cfea4d4ecb06b846308878b4d983b11b2`
- DB/runtime state: Podium B pointer `mamelles_open_open_r2_h3`.
- After a single Admin reload, DOM selects remained `OPEN / R3 / H1` at 0, 25, 50, 100, 250, 500, 1000, 2000, 3000 and 5000 ms.
- Judge and Display remained on `OPEN / R2 / H3`; no data was modified during reproduction.

## Root cause

`loadConfigFromDb` correctly hydrates the canonical B pointer, but the AdminInterface round/heat reconciliation effect then runs with no pending operator division selection. It excludes active pointers and writes the first merely eligible heat (`R3H1`) over the hydrated config. Initial hydration has no pending division selection, so this is a post-hydration reconciliation overwrite.

## Patch and validation

- Added a guard in the reconciliation effect: when `configSaved` is true and no pending operator selection exists, hydration remains authoritative.
- Unsaved division/round/heat navigation still sets `configSaved=false` and continues through reconciliation.
- Targeted tests: 9 passed.
- TypeScript: passed (`npx tsc --noEmit -p frontend/tsconfig.json`).
- Field build: passed.
- Deployment: `surfjudging-2026.08.14-p2.7.58-admin-reload-hydration`.
- Served revision: `2507f3141552b07a139089df1c4a33c8d893f92b`.
- Served Admin bundle: `AdminPage-B9NmIVhe.js` (runtime verified).
- Live reload trace after patch: `0/25/50/100/250/500/1000/2000/3000/5000ms = OPEN/R2/H3`.
- No-SAVE draft check: BENJAMIN selected, then OPEN draft; no SAVE issued. Reload restored `OPEN/R2/H3`.
- Judge/Display B remained `OPEN/R2/H3`; no score, start, close, or DB cleanup performed.

## Required post-deploy matrix

Reload convergence, A↔B pointer restoration, unsaved draft/no DB mutation, reload discards draft, and P2.7.57 no-SAVE pointer regression remain to be certified on the served P2.7.58 bundle.

## Certification matrix

| Check | Result |
|---|---|
| A reload hydration | PASS — B restores R2H3 |
| B post-reload stability | PASS — stable 5s |
| C unsaved draft | PASS — no SAVE, pointer unchanged by observation |
| D reload discards draft | PASS — restores R2H3 |
| E P2.7.57 no-SAVE regression | PASS — no activation path retained |
| F/G Judge and Display regression | PASS — existing B clients remain R2H3 |
| H/I/A↔B restore matrix | NOT RUN in this pass |
| J final DB audit | NOT RUN (read-only runtime scope) |

**VERDICT: ADMIN RELOAD HYDRATION CERTIFIED (SCOPED)**
