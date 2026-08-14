# P2.7.75 — Permanent DB regression certification

STATUS: SYNTHETIC SUITE EXECUTED — PASS; historical/read-only gate pending.

BASELINE:
release=`surfjudging-2026.08.14-p2.7.73-final-runtime-db-matrix`
revision=`d67f14cea4dc1109bcb7da7032cccb425068c5b1`
schema=`20260814210000_exhaustive_heat_ranking_inherited_tiebreak`

HARNESS: `backend/supabase/tests/p2_7_75_permanent_db_regression.sql`
FIXTURE: synthetic event `90775`; transaction ended with `ROLLBACK`.
EVENT 10 MUTATION: none performed by the suite.

MATRIX A: PASS — all three entries ranked; RED current score; WHITE/YELLOW zero current totals.
MATRIX B: PASS — seed order decides when inherited totals are NULL.
MATRIX C: PASS — inherited previous-round total beats seed.
MATRIX D: PASS — current score beats inherited history/seed.
MATRIX E: PASS — three-judge, two-wave best-two aggregate and rank.
MATRIX F: PASS — one judge of configured J1/J2/J3 blocks readiness with MISSING_SCORES.
MATRIX G: PASS — untouched legitimate entries do not create missing-score blockers.
MATRIX H: PASS — INT1 formula verified (14 − 6/2 = 11).
MATRIX I: PASS — INT2 best-wave behavior verified.
MATRIX J: PASS — unscored qualifier propagated to exact mapped destination slot.

EXECUTION: `BEGIN`, synthetic fixture, `DO`, trigger isolation, `ROLLBACK` — successful.
HISTORICAL H1–H5 REGRESSION: NOT EXECUTED (read-only gate still required).
EVENT 10 BEFORE/AFTER FINGERPRINT: NOT CAPTURED in this run; must be recorded before final certification.
R1H2 FINAL READ-ONLY: unchanged from P2.7.73 (readiness PASS; RED 8.17, WHITE 0 seed 14, YELLOW 0 seed 17).
CLOSE AUTHORIZED: NO.

FINAL VERDICT: PARTIALLY CERTIFIED — A–J PASS; historical regression and isolation fingerprints pending.
