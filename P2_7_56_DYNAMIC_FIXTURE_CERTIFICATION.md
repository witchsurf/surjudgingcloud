# P2.7.56 — Dynamic Fixture First-Available Certification

FIELD_HOST: `10.0.0.10`
FIELD RELEASE: `surfjudging-2026.08.14-p2.7.54-division-reconciliation-fix-808ca03`
FIELD REVISION: `808ca0351f0715fedb4febcff921cbfdef84e889`
ADMIN BUNDLE: `AdminPage-9nju6FLm.js`
SOURCE == SERVED: YES (application code; HEAD also contains report-only commit)
BUNDLE MATCH: YES

DB BEFORE:
A = `mamelles_open_benjamin_r2_h1`
B = `mamelles_open_open_r2_h3`

Dynamic OPEN matrix: R1H1–R2H2 closed; R2H3 open/current B; R3H1 open/free; R3H2 open/free; R4H1 open/free.
EXPECTED DESTINATION: `mamelles_open_open_r3_h1`

LIVE TRACE (B BENJAMIN → OPEN, no SAVE):
T0 = OPEN/R2/H1
+100ms = OPEN/R3/H1
+250ms = OPEN/R3/H1
+500ms = OPEN/R3/H1
+1s = OPEN/R3/H1
+2s = OPEN/R3/H1
+3s = OPEN/R3/H1
+5s = OPEN/R3/H1
+10s = OPEN/R3/H1

EXPECTED TARGET REACHED: YES
OSCILLATION: NO
10S STABILITY: YES
AUTO-SELECTION: PASS

Immediately after the passive test, the authoritative pointer read was already B=`mamelles_open_open_r3_h1` (updated_at changed), despite no SAVE click. Therefore the destination was no longer free/current-safe for the mandated one-click SAVE.

SAVE CLICKS: 0 (safely not attempted)
FIRST SAVE: NOT ATTEMPTED
JUDGE/DISPLAY: NOT TESTED
FINAL VERDICT: D — FIRST SAVE NOT EXECUTED; automatic pointer activation before SAVE requires separate investigation.
