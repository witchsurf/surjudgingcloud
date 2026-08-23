# P2.7.64 — Admin explicit draft ownership

FIELD_HOST: `10.0.0.10`
BASELINE: `surfjudging-2026.08.14-p2.7.63-db-authoritative`
ADMIN BUNDLE: served from P2.7.63 clean runtime
SOURCE == SERVED: YES
BUNDLE MATCH: YES

DB COMMITTED X: `mamelles_open_open_r3_h2`
VALID DRAFT Y: `mamelles_open_open_r3_h1` (open, distinct, free)

DRAFT TRACE:
T0=`OPEN/R3/H1`; +25ms=`OPEN/R3/H1`; +50ms=`OPEN/R3/H1`; +100ms=`OPEN/R3/H1`; +250ms=`OPEN/R3/H1`; +500ms=`OPEN/R3/H1`; +1s=`OPEN/R3/H1`; +2s=`OPEN/R3/H1`; +3s=`OPEN/R3/H1`; +5s=`OPEN/R3/H1`.

R2H3 SOURCE: prior attempted round-control interaction; direct explicit heat selection does not restore it.
WRITER: no overwrite observed for valid explicit heat draft.
TRIGGER: direct heat select; draft remained stable.

MODE BEFORE: COMMITTED (`OPEN/R3/H2`)
MODE AFTER USER ACTION: EXPLICIT_DRAFT (`OPEN/R3/H1`)
FIRST DIVERGING WRITER: none — explicit draft ownership works.
ROOT CAUSE: P2.7.63 draft failure was an invalid round-control interaction, not a proven ownership overwrite.
ROOT CAUSE PROVEN: YES for draft ownership behavior.

PRE-PATCH REGRESSION: explicit valid heat draft remains Y; DB remains X.
FIX: none.

MATRIX A-L: A/B/C/D/E/F/G/H/I pass for this draft scenario; J/K/L not run.

FINAL LIVE DRAFT: ADMIN=`OPEN/R3/H1`, DB=`OPEN/R3/H2`, JUDGE=`OPEN/R3/H2`, DISPLAY=`OPEN/R3/H2`.
RELOAD: Admin returned X (`OPEN/R3/H2`).

P2.7.63 RESUMED: YES — one SAVE was then issued after reload.
SAVE CLICKS: 1
DB AFTER SAVE: B=`mamelles_open_open_r3_h1`
ADMIN: committed destination selected.
JUDGE: remained `OPEN/R3/H2` at 0–10s.
DISPLAY: not evaluated after first failing stage.

FIRST FAILING STAGE: DB committed B `OPEN/R3/H1` but existing Judge B did not converge; active Realtime channel was previously `CLOSED`.
30S: not run.
P2.7.59 RESUME ALLOWED: NO.
PUSH: none.

FINAL VERDICT: BLOCKED — DB→Judge Realtime delivery remains unresolved.
