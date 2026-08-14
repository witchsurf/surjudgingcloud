# P2.7.65 — DB commit → active Realtime generation forensic

DIAGNOSTIC COMMIT: `79a8c96`
FIX COMMIT: `75fc550`
DIAGNOSTIC RELEASE: `surfjudging-2026.08.14-p2.7.65-db-authoritative-fix`

AUTHORITATIVE BEFORE: A=`mamelles_open_cadet_r1_h1`, B=`mamelles_open_open_r3_h1`.
DRAFT Y: `mamelles_open_open_r3_h2`.

PRE-SAVE: DB B=`R3H1`, Admin=`R3H2`, Judge=`R3H1`, Display=`R3H1`.
SAVE: exactly 1 click.
DB COMMIT: B=`mamelles_open_open_r3_h2` at `2026-08-14T19:08:09.353832+00:00`.

JUDGE GENERATION: generation 2, listener `JudgePage:event10:podiumB`, status `SUBSCRIBED`, listeners=1.
POINTER_EVENT_RAW: YES, generation 2.
RAW PAYLOAD: `{}` — no `active_heat_id`.
LISTENER DISPATCH: NO (manager rejected the empty envelope).
JUDGE CALLBACK: NO.
DOM: remained `OPEN/R3/H1` through +10s.

FIRST BROKEN STAGE: shared manager payload validation before listener dispatch.
CLASSIFICATION: D — raw pointer event received but shared manager did not dispatch Judge.
ROOT CAUSE: Realtime UPDATE envelope lacked row body; manager treated it as non-event instead of resolving authoritative DB state.
ROOT CAUSE PROVEN: YES.

PRE-PATCH REGRESSION: contract test added for empty envelope → targeted DB refresh.
FIX: empty active-pointer payload now calls the existing authoritative `refresh()` path; no polling/reload/reconnect added.
TESTS: targeted 5 passed; typecheck passed.

## Final clean certification

FIELD_HOST: `10.0.0.10`
CLEAN RELEASE: `surfjudging-2026.08.14-p2.7.65-db-authoritative-clean`
CLEAN REVISION: `75fc550feb2e6dcc82e144ce9705da6c7e0d6ae5`
SERVED BUNDLES: index `index-7iEjbJXI.js`; Judge/Display chunks present in the clean build; served index hash matches local build.
DIAGNOSTICS: removed from shared manager and Judge; only empty-payload DB refresh remains.

LIVE SAVE: one click, DB B pointer committed to `mamelles_open_open_r3_h1` at `2026-08-14T19:12:02.307999+00:00`.
JUDGE B: no reload; `R3 H1` at 0/100/250/500/1000/2000/3000/5000/10000 ms. Empty Realtime envelope was resolved through the DB refresh path.
DISPLAY B: remained rendered `R3 H2` during this transition; therefore Display no-reload convergence is not certified in this run. Reload hydration is required before further Display testing.
DB/ADMIN after save: B=`mamelles_open_open_r3_h1`; A unchanged=`mamelles_open_cadet_r1_h1`.

FIRST BROKEN STAGE BEFORE FIX: shared manager rejected empty pointer envelope.
FIX RESULT: DB→Judge PASS; DB→Display live convergence NOT PROVEN/PASS.
FINAL VERDICT: PARTIALLY CERTIFIED — JUDGE DB-AUTHORITATIVE DELIVERY CERTIFIED; DISPLAY FOLLOW-UP REQUIRED.
