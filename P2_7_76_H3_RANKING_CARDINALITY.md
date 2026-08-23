# P2.7.76 — H3 ranking cardinality forensic

H3 BASE ENTRIES: `mamelles_open_junior_r2_h1` has exactly 4 unique entries: RED/WHITE/YELLOW/BLUE, one row each.

H3 RAW RANKING: 96 rows; BLUE 5, RED 7, WHITE 5, YELLOW 7. Distinct ranked identities remain 4.

CARDINALITY TRACE: base `heat_entries` = 4; target mappings = 4 (one per position); source lookup fan-out = RED 7, WHITE 5, YELLOW 7, BLUE 5; ranking output = 96.

FIRST DIVERGING STAGE: `lineage.source_heat` join in `fn_rank_heat_entries_exhaustive`.

ROOT CAUSE: source heat is joined by `event_id + source_round + source_heat` without division. H3 mappings R1-H1/R1-H2 therefore join every division sharing those coordinates.

ROOT CAUSE PROVEN: YES.

DATA VS QUERY: historical mappings are legitimate; source heat predicate is non-unique. No historical rows deleted.

BLAST RADIUS: later-round scan — Benjamin R2H1 96/4, Junior R2H1 96/4, Ondine U16 R2H1 96/4, Open R2H1 60/4, Open R2H2 24/3, Open R2H3 33/3, Open R3H1 14/2, Open R3H2 14/2.

REGRESSION K BEFORE PATCH: added to `p2_7_75_permanent_db_regression.sql`; expected to FAIL against current production function because two synthetic source divisions share round/heat 1/20.

PATCH: none in this phase. No production SQL, migration, deployment, score, pointer, assignment, or status change.

A–J: previously certified 10/10 PASS. K execution awaits the explicit pre-patch run output.
H3 AFTER: not applicable before patch; current result remains duplicated.
HISTORICAL: FAIL pending correction and re-run.
EVENT 10 ISOLATION: PASS (prior before/after fingerprints identical).

COMMIT: not created from this session.
RELEASE: unchanged P2.7.73.
SCHEMA: `20260814210000_exhaustive_heat_ranking_inherited_tiebreak`.
SOURCE == SERVED: unchanged prior certification.
SCHEMA == EXPECTED: unchanged prior certification.
BUNDLE MATCH: unchanged prior certification.

R1H2: OPEN, readiness PASS, RED 8.17 / WHITE 0 seed 14 / YELLOW 0 seed 17.
CLOSE AUTHORIZED: NO.

FINAL VERDICT: BLOCKED — lineage division disambiguation required before one-close certification.
