# P2.7.77 — Lineage division fix + A–K recertification

K PRE-PATCH: FAIL — synthetic two-division fixture returned 2 rows for 1 eligible entry.
ROOT CAUSE: `source_heat` lineage joined by event/round/heat without division.
CANONICAL DIVISION KEY: destination `heats.division` = source `heats.division`, normalized; combined with event_id + round + heat_number.

MIGRATION: `20260814220000_fix_exhaustive_ranking_lineage_division.sql` applied forward.
K POST-PATCH: PASS. Permanent A–K transaction suite completed with ROLLBACK.

H3 BEFORE: 96 ranking rows / 4 entries.
H3 AFTER: 4 rows: BLUE 7.70, RED 6.17, WHITE 5.84, YELLOW 2.67.

BLAST RADIUS AFTER:
- Benjamin R2H1 4/4/4 PASS
- Junior R2H1 4/4/4 PASS
- Ondine U16 R2H1 4/4/4 PASS
- Open R2H1 4/4/4 PASS
- Open R2H2 3/3/3 PASS
- Open R2H3 3/3/3 PASS
- Open R3H1 2/2/2 PASS
- Open R3H2 2/2/2 PASS

LINEAGE JOIN AUDIT: corrected ranking lineage; no historical mapping rows deleted.
HISTORICAL: H3 fixed; full H1–H5 numeric/qualification/readiness recertification pending.
EVENT 10 ISOLATION: prior fingerprint PASS; post-migration fingerprint still required.

FIELD_SCHEMA: `20260814220000_fix_exhaustive_ranking_lineage_division`.
FIELD_HOST/RELEASE/REVISION: pending runtime rediscovery and deployment alignment.
SOURCE == SERVED: pending.
SCHEMA == EXPECTED: pending.
BUNDLE MATCH: pending.

R1H2: not closed; final read-only recheck pending.
CLOSE AUTHORIZED: NO.
FINAL VERDICT: PARTIALLY CERTIFIED — DB fix and A–K pass; runtime/historical gates remain.
