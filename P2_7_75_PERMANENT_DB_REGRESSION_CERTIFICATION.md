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

## Finalize — historical/event-10 read-only pass

EVENT 10 BEFORE/AFTER fingerprints: IDENTICAL (assignment 75/`9d6a7fb8fb33965483df16da0c1ae188`; entry 106/`80d911ad9f456a130200ac4c44247d4d`; heat_status 29/`a6af4ffc6e074deaca9620209532a0a9`; interference 6/`fdb430d2953564a454122ac29e90e612`; pointer 2/`d5fb243a3595c49aa3917f2c7b8b0cf7`; score 194/`c04c409fe4a11148631ff752b63151eb`).
EVENT 10 ISOLATION: PASS.

H1 `mamelles_open_benjamin_r1_h1`: 3-judge closed, numeric output readable; readiness PASS.
H2 `mamelles_open_junior_r1_h1`: 3-judge closed, numeric output readable; readiness PASS; interference history present.
H3 `mamelles_open_junior_r2_h1`: readiness PASS, but ranking emits duplicate rows (BLUE 5x, RED 7x, WHITE 5x, YELLOW 7x) although `heat_entries` are unique. This is an unexplained historical ranking regression.
H4 `mamelles_open_open_r1_h1`: 3-judge closed, exhaustive zero-score entries present; readiness PASS.
H5 5-judge heat: NOT AVAILABLE; no closed event-10 heat has a 5-judge panel.
ZERO-SCORE HISTORICAL: observed on H4 and emitted by current exhaustive ranking.
QUALIFICATION HISTORICAL: Junior R2H1 mappings readable, but strict comparison blocked by H3 duplicate ranking.
READINESS HISTORICAL: H1/H2/H3/H4 PASS; no mutation performed.
HISTORICAL REGRESSION: FAIL — H3 duplication unexplained.
R1H2 FINAL READ-ONLY: unchanged; OPEN, readiness PASS, ranking RED 8.17 / WHITE 0 seed 14 / YELLOW 0 seed 17.
PODIUM A: pointer/status unchanged (read-only check).
CLOSE AUTHORIZED: NO — historical regression H3 must be investigated before P2.7.76.

FINAL VERDICT: BLOCKED — event isolation PASS, A–J PASS, but historical H3 ranking duplication prevents authorization.
