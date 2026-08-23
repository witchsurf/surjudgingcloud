# P2.7.32 — Reconciliation decision

W5 helper inputs: division `OPEN`; current B `R2/H3`; A active `R3/H1`; statuses R2H1/R2H2 closed, R2H3/R3H1/R3H2/R4H1 open; active IDs excluded; pending selection `OPEN/R3/H2`.

W5 old output: the inline effect could derive from stale `visibleRoundOptions`/sequence and preserve or rewrite the current `R2/H3`.

W5 expected output: `KEEP R3/H2` while pending; after pending consumption, no rewrite of valid `R3/H2`.

W5 causal: YES — the isolated decision contract required pending selection precedence over stale derived inputs.

Production patch: extracted `frontend/src/utils/reconcileRoundHeat.ts` and replaced only the W5 decision body in `AdminInterface.tsx`; no selector, save, Realtime, Judge, Display, or DB changes.

Tests: reconciliation helper 5/5 PASS; selector contract 3/3 PASS; TypeScript PASS; `npm run build:field` PASS.

ReleaseId: not deployed in this run.
Served SHA: not applicable.
Live t0 / +500ms / +2s / +5s: not run; no live transition or SAVE performed.
SAVE clicks: 0. SAVE result: not run.
A pointer: unchanged/not queried. B pointer: unchanged/not queried. 23514: not observed.
Required commits: none created; existing experimental chain not pushed.
Push: not performed.

Verdict: **BLOCKED** — code-level W5 contract is tested, but required Mac Field deployment and live stability/SAVE certification remain outstanding.

## MAC FIELD LIVE CERTIFICATION ATTEMPT

Repository HEAD before deploy: `42492e080cf5926c3bd6a2719994d38f9a0272a0`.
Working tree dirty: **YES**. W5 files are `frontend/src/utils/reconcileRoundHeat.ts`, its test, and the W5 call-site change in `AdminInterface.tsx`; other prior reports/artifacts were preserved and not discarded.
ReleaseId built: `surfjudging-2026.08.13-p2.7.32-w5-reconciliation`.
Build: completed successfully; local manifest contains the requested release id. Served runtime verified: **NO** — `192.168.1.74:8080` was unreachable and local Docker was unavailable (`docker info` failed), so no deploy/restart or HTTP bundle proof was possible.
DB A/B before: not queried because the authoritative Mac runtime was unreachable. Expected destination: not recalculated.
Admin T0/+500ms/+2s/+5s: not run. AUTO-SELECTION PASS: NOT RUN.
Destination free / B judges / SAVE clicks / first-click persisted / 23514 / A pointer after / B pointer after / assignments: NOT RUN.
Judge/Display passive observations and channel/polling: NOT RUN.
W5 commit: none. Required P2.7.31 commits: not pushed. Push: not performed.

Final verdict: **BLOCKED** — build is ready, but Mac Field deployment and live certification require the Mac runtime at `192.168.1.74` to be started/reachable.
