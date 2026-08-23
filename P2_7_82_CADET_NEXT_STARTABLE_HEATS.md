# P2.7.82 — CADET next startable heats (read-only)

FIELD = `10.0.0.10:8080`
Release = `surfjudging-2026.08.14-p2.7.78-lineage-fix`
No mutation performed.

## CADET state

| Heat | Status | Active podium | Entries | Judges | Start gate |
|---|---|---|---|---|---|
| R1H1 | OPEN | A | 4/4 materialized | J1 CHARLES, J2 J1MAIMOUNA, J3 JKHADIJA | `ok=true` |
| R1H2 | CLOSED | none | 3/3 | J1 NGALLA, J2 MAMADOU, J3 KHADIOU | n/a |
| R1H3 | OPEN | none | 3/3 | J1 CHARLES, J2 J1MAIMOUNA, J3 JKHADIJA | `ok=true` |
| R1H4 | OPEN | none | 3/3 | none | `ok=true`, assignment gate separately fails |
| R2H1 | OPEN | none | P26 only; 3 feeder slots empty | J1 CHARLES, J2 J1MAIMOUNA, J3 JKHADIJA | `ok=false` |
| R2H2 | OPEN | B | P21 only; 3 feeder slots empty | J1 NGALLA, J2 MAMADOU, J3 KHADIOU | `ok=false` |
| R3H1 | OPEN | none | 0/4 | none | `ok=false` |

## Feeder graph

- R2H1: R1H1/P1 (open), R1H4/P1 (open), R1H2/P2 (closed/materialized P26), R1H3/P2 (open).
- R2H2: R1H2/P1 (closed/materialized P21), R1H3/P1 (open), R1H1/P2 (open), R1H4/P2 (open).
- R3H1: R2H1/P1,P2 and R2H2/P1,P2; both R2 sources remain open.

## Start gates and operational plan

- R1H1: **READY YES**, no unresolved feeder, complete lineup and assignments; current A pointer already correct.
- R1H3: gate YES, but cannot run on B with current assignments because all three judges are active on A.
- R1H4: gate YES, but no judge assignments exist.
- R2H1: **READY NO** — R1H1, R1H4, R1H3 still open.
- R2H2: **READY NO** — R1H3, R1H1, R1H4 still open.
- R3H1: **READY NO** — R2H1/R2H2 open and empty.

NEXT STARTABLE ON A = `mamelles_open_cadet_r1_h1` (READY YES).
NEXT STARTABLE ON B = NONE with current assignments; R1H3 needs judge reassignment and R1H4 needs assignments.

RECOMMENDED OPERATIONAL PLAN:

1. A = start R1H1 through the normal UI (future authorized action).
2. B = remain on R2H2; after feeder completion, re-evaluate R2 readiness and use normal assignment/transition workflow.

MUTATIONS PERFORMED = NONE

FINAL VERDICT = READY FOR CONTROLLED R1 START/TRANSITION (A/R1H1 only)
