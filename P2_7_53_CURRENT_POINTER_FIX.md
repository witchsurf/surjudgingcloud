# P2.7.53 — Current-pointer fix

ROOT CAUSE: **PROVEN PARTIALLY**. The pure W5 decision previously preserved an
excluded current heat when no eligible heat existed in the current round. The
fix now searches the first eligible heat across rounds.

PRE-PATCH REGRESSION: PASS TO REPRODUCE (exact fixture returned R2H3 before patch)
FIX: `reconcileRoundHeat` now filters all target-division heats, preserves the
current heat only when still eligible, otherwise selects the first sorted free,
non-closed heat across rounds.

TEST MATRIX: A=PASS pure; B=PASS pure; C=not run; D=not run; E=PASS; F=PASS; G=PASS pure.
FOCUSED TESTS: 10/10 passed
TYPECHECK: PASS
BUILD: PASS

COMMIT: `76755f80ac3bec60a13acfbbc0300699d4653bf4`
BUILD RELEASE: `surfjudging-2026.08.13-p2.7.53-current-pointer-fix-76755f8`
LOCAL BUNDLE: `AdminPage-CgYV8Yqp.js`
LOCAL HASH: SHA-256 `74dd5dc14e2abe4e9d55694cad6596d538fa66691420ec9f22fc2965d6974b2d`

SERVED RELEASE: same
SERVED REVISION: `76755f80ac3bec60a13acfbbc0300699d4653bf4`
SERVED BUNDLE: `AdminPage-CgYV8Yqp.js`
SERVED HASH: checksum-equivalent (length 182453, Adler-32 1594892377)
SOURCE == SERVED: YES
BUNDLE MATCH: YES

LIVE DB FIXTURE BEFORE RETEST: A=`mamelles_open_benjamin_r2_h1`; B was observed
as `mamelles_open_open_r3_h1` before the transition; OPEN R3H1/R3H2/R4H1 open.

LIVE AUTO-SELECTION: **FAIL**. Without SAVE, controlled values were:
`+1ms OPEN/R2/H1`, `+61ms OPEN/R2/H3`, `+115ms OPEN/R2/H3`, `+269ms OPEN/R2/H3`,
`+524ms OPEN/R2/H3`, `+1028ms OPEN/R3/H1`, `+2032ms OPEN/R2/H3`, `+3036ms OPEN/R3/H1`,
`+5040ms OPEN/R2/H3`.

SAVE CLICKS: 0
JUDGE B AUTO REFRESH: not tested
DISPLAY B AUTO REFRESH: not tested
30S STABILITY: not tested

FINAL VERDICT: **AUTO-SELECTION FAIL**. No further patch, SAVE, or DB mutation
performed. Commit remains local and is not pushed pending a corrected fix.
