# P2.7.84 — Podium A live score propagation certification

FIELD:
- HOST = `10.0.0.10`
- RELEASE = `surfjudging-2026.08.14-p2.7.78-lineage-fix`
- REVISION = `17ed8b0799a9a0298b7d6b7812f57403432b093d`
- SCHEMA = `20260814220000_fix_exhaustive_ranking_lineage_division`

## Fresh state / clients

- A status = RUNNING; timer start `2026-08-15T07:52:41.555Z`; score count initially 0.
- B status = WAITING/OPEN; score count 0; B pointer remained R2H2.
- Admin A, Judge A and Display A mounted on event 10 / CADET / R1H1.
- Judge A station = J1; assignment = CHARLES (`5164895e-51e9-42f2-9583-80a3e36cc435`).
- B assignments remained NGALLA/MAMADOU/KHADIOU.

## Target / one submission

- Target = RED / wave 1 / J1 CHARLES; previous value absent.
- Test score = `6.50`.
- SCORE_SUBMIT_ACTION_COUNT = **1**.
- Normal Judge UI keypad used; no direct insert, retry, second score, SAVE or close.

## DB immediate

- Exactly one new row: event 10, CADET R1, J1/CHARLES, station J1, identity `5164895e-51e9-42f2-9583-80a3e36cc435`, RED/V1, score 6.50.
- Score count delta = +1; unrelated score changes = none.
- B remained unchanged (pointer R2H2, waiting, no scores).

## Partial panel / aggregation

- Readiness RPC: `can_close=false`, blocker `MISSING_SCORES`, two missing J2/J3 RED/V1 notes.
- Incomplete panel = YES; current total = `0.00`.
- Ranking RPC exposes RED best-two as 6.50 with remaining entries at 0; wave is visibly marked partial (`*`).

## No-reload and stability

- Judge A acknowledged/persisted `ROUGE V1 = 6.5` without reload.
- Admin A showed `V1:6.50*` and total 0 without reload.
- Display A showed RED 6.50 with the partial marker; no aggregate completion was shown.
- After +30s: score remained exactly once, A remained running, B remained waiting/R2H2, no score removal or qualification mutation.

## Reload

- Judge A reload then identity confirmation restored R1H1 and `1 6.5`.
- Admin A reload restored R1H1, Pause/running state and `V1:6.50*`.
- Display A was not reloaded after no-reload evidence.

B ISOLATION = PASS.  NETWORK: one score mutation observed; no repeated insert/upsert, SAVE, pointer or qualification writes; no storm.

FINAL VERDICT: **PASS — SINGLE JUDGE SCORE PROPAGATION CERTIFIED**
