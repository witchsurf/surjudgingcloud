# P2.7.57 — Unsaved Pointer Activation Forensic

FIELD_HOST: `10.0.0.10`
RELEASE: `surfjudging-2026.08.14-p2.7.57-unsaved-pointer-fix-3f94494`
REVISION: `3f94494cfea4d4ecb06b846308878b4d983b11b2`
BUNDLE: `AdminPage-8AqswW1G.js`
SOURCE == SERVED: YES
BUNDLE MATCH: YES

SAVE CONTRACT MODEL: A — selection is draft; SAVE commits runtime config, assignments, entries, then pointer.

POINTER WRITERS:
- PW1 `AdminInterface.tsx:2827` (pre-fix): 700 ms auto-assignment effect; NO SAVE; calls `heatLifecycleRepository.activate`.
- PW2 `HeatRepository.ts:439`: canonical `saveHeatConfig`; requires SAVE; calls `activateHeatOnPodium` after runtime config and assignments.

UNSAVED POINTER WRITER: PW1
TRIGGER: config heat/division selection effect
CALL CHAIN: AdminInterface effect → panelRepository.setPodiumPanel → heatLifecycleRepository.activate → activate_heat_on_podium.
SELECTION EMITS DB MUTATION: YES before fix; fixed in served P2.7.57.

PRE-PATCH REGRESSION: FAIL reproduced (pointer changed without SAVE).
POST-PATCH NO-SAVE: PASS — B remained `mamelles_open_open_r3_h1` while draft selected `OPEN/R2/H3` for 10 s.

SAVE CLICKS: 1
FIRST SAVE: 204 runtime RPC, assignments 201; pointer B became `mamelles_open_open_r2_h3`.
JUDGE B: `MAMELLES OPEN / OPEN / R2 H3`
DISPLAY B: `MAMELLES OPEN / OPEN / R2 H3`
30S STABILITY: Judge/Display remained R2H3.

FINAL NOTE: after a subsequent Admin reload, the Admin draft re-derived R3H1 while Judge/Display/DB remained R2H3. First failing final-consistency stage is Admin draft rehydration; this is outside the proven unsaved-pointer fix.

FINAL COMMIT: `3f94494cfea4d4ecb06b846308878b4d983b11b2`
FINAL RELEASE: `surfjudging-2026.08.14-p2.7.57-unsaved-pointer-fix-3f94494`
PUSH: not performed
FINAL VERDICT: PARTIAL — unsaved pointer activation fixed; Admin post-reload draft convergence remains unresolved.
