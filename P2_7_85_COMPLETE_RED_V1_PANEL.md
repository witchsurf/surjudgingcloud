# P2.7.85 — Complete RED V1 three-judge panel

FIELD:
- HOST = `10.0.0.10`
- RELEASE = `surfjudging-2026.08.14-p2.7.78-lineage-fix`
- REVISION = `17ed8b0799a9a0298b7d6b7812f57403432b093d`
- SCHEMA = `20260814220000_fix_exhaustive_ranking_lineage_division`

## Pre

- A = CADET R1H1 RUNNING; B = CADET R2H2 WAITING.
- RED/V1: J1=6.50, J2 absent, J3 absent; current total 0.00; readiness blocked by two missing scores.
- J2 identity/station = J1MAIMOUNA/J2; J3 identity/station = JKHADIJA/J3.

## J2

- IDENTITY = J1MAIMOUNA (`442df135-52cb-4037-895f-5a174de825ca`)
- SUBMIT COUNT = 1; SCORE = 7.00.
- DB result = J1 6.50, J2 7.00, J3 absent; score delta +1.
- Readiness after J2 = `can_close=false`, one `MISSING_SCORES` blocker for J3 RED/V1.
- Admin/Display showed partial RED V1 `6.75*`, excluded from total.

## J3

- IDENTITY = JKHADIJA (`c724401b-46ba-4b3e-8227-d8c46110eb2e`)
- SUBMIT COUNT = 1; SCORE = 7.50.
- DB result = J1 6.50, J2 7.00, J3 7.50; exactly three rows, no duplicates.

## Final panel / aggregation

- EXPECTED AGGREGATE = `(6.50 + 7.00 + 7.50) / 3 = 7.00`.
- PRODUCTION AGGREGATE = 7.00 (`fn_rank_heat_entries_from_scores` RED best_two).
- AGGREGATE MATCH = YES.
- CURRENT TOTAL = 7.00; one completed wave; other surfers remain 0/partial.
- Readiness = `can_close=true`, blockers `[]`; no close performed.

## No-reload / isolation / stability

- J1, J2, J3 displayed persisted RED/V1 values; Admin and Display transitioned from partial to `V1:7.00`, total 7.00 without reload.
- B pointer/status/entries/assignments/scores unchanged (`R2H2`, waiting, 0 scores). B ISOLATION = PASS.
- Network score mutations = J2: 1, J3: 1, total 2; no SAVE, pointer, qualification writes or storm observed.
- +30s: DB, aggregate, clients and B stable; no duplicates.
- Admin reload restored `V1:7.00` and total 7.00. Display was not reloaded after no-reload evidence.

FINAL VERDICT: **PASS — RED V1 COMPLETE 3-JUDGE AGGREGATE CERTIFIED**
