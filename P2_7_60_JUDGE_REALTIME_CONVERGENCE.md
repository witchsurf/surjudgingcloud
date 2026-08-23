# P2.7.60 — Judge B Realtime convergence forensic

FIELD_HOST: `10.0.0.10`
BASELINE: `surfjudging-2026.08.14-p2.7.58-admin-reload-hydration`
JUDGE BUNDLE: `JudgePage-CCvV_kHZ.js`
SOURCE == SERVED: YES (`2507f3141552b07a139089df1c4a33c8d893f92b`)
BUNDLE MATCH: YES

DB B: `mamelles_open_open_r3_h2`
JUDGE PRE-RELOAD: `OPEN/R2/H3`

REALTIME CHANNEL: `shared-active-heat-10:podium:B`
STATUS: `CLOSED` (runtime console: “Shared active heat channel dropped for key 10:podium:B: CLOSED”)
FILTER: `event_name=eq.MAMELLES OPEN`; runtime callback additionally requires `podium_id=B`
SUBSCRIBED HEAT: none reliably active; channel closed

P2.7.59 POINTER EVENT RECEIVED: NO / NOT PROVEN
CALLBACK: NO evidence
DESTINATION EXTRACTED: NO (from realtime)
CONFIG LOAD: NO transition-triggered load; initial/reload loads only
STATE UPDATE: NO
DOM UPDATE: NO

FIRST BROKEN STAGE: active-heat Realtime subscription lifecycle (channel CLOSED).

MANUAL RELOAD RESULT: `OPEN/R3/H2` — hydration PASS; realtime convergence FAIL.

P2.7.57 VS P2.7.59 DIFFERENCE: P2.7.57’s earlier B transition had a live convergence observation; in the current P2.7.59 runtime the shared B channel is explicitly CLOSED before/around the transition. Same-division/different-round logic was not reached because the subscription was not active.

SAME-DIVISION POINTER CHANGE BUG: NOT PROVEN.
ROOT CAUSE: channel lifecycle/Realtime closure, exact transport cause not yet proven.
ROOT CAUSE PROVEN: YES for first broken stage; NO for deeper transport cause.

PRE-PATCH REGRESSION: not created; production callback cannot be exercised while channel is CLOSED.
FIX: none (forensic stop).

MATRIX A-H: blocked at subscription status; no mutation performed in this forensic phase.

FINAL COMMIT: none
FINAL RELEASE: unchanged
FINAL JUDGE BUNDLE: `JudgePage-CCvV_kHZ.js`
LIVE POINTER: `OPEN/R3/H2`
LIVE JUDGE: `OPEN/R3/H2` after manual reload only
JUDGE AUTO REFRESH: FAIL
DISPLAY: not tested after first failing stage
DISPLAY AUTO REFRESH: not tested
30S: not run
PUSH: none

FINAL VERDICT: BLOCKED — Judge B active-heat channel CLOSED before convergence.
