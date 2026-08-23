# P2.7.83 — Podium A CADET R1H1 one-start certification

FIELD:
- HOST = `10.0.0.10`
- RELEASE = `surfjudging-2026.08.14-p2.7.78-lineage-fix`
- REVISION = `17ed8b0799a9a0298b7d6b7812f57403432b093d`
- SCHEMA = `20260814220000_fix_exhaustive_ranking_lineage_division` (runtime manifest schema)

## Pre-start

- A pointer = `mamelles_open_cadet_r1_h1`; A status = `OPEN`.
- A entries = 4/4 (P20 RED, P27 WHITE, P28 YELLOW, P32 BLUE).
- A assignments = J1 CHARLES, J2 J1MAIMOUNA, J3 JK​​HADIJA.
- A scores = 0; interference = 0.
- Start gate = `validate_heat_start_dependencies`: `ok=true`.
- Assignment gate = complete/valid (3/3).
- START AUTHORIZED = YES.

## B immutable baseline

- B pointer = `mamelles_open_cadet_r2_h2`; status = OPEN.
- B entries = P21 RED materialized; WHITE/YELLOW/BLUE null.
- B assignments = J1 NGALLA, J2 MAMADOU, J3 KHADIOU; scores/interference = 0.

## Start

- UI precheck showed Admin A CADET/R1/H1 OPEN and `Start` available; no SAVE.
- START_ACTION_COUNT = **1**.
- START response: normal UI action returned without error.
- No second START, close, score, assignment, mapping, or pointer action.

## DB immediate / +30s

- A pointer remained R1H1; `heat_realtime_config`: `status=running`, `timer_start_time=2026-08-15T07:52:41.555Z`, duration 20 minutes.
- A entries/assignments/scores/interference unchanged.
- B pointer remained R2H2; B realtime remained `waiting` with null start time; B entries unchanged.
- At +30s A remained running and B remained waiting/open; timer advanced coherently; scores and qualification data unchanged.

## Clients / reload

- Admin A no-reload: running state and Pause control; reload restored CADET/R1/H1 with Pause.
- Judge A / Display A / Priority A / Overlay A: not present in the existing connected session, therefore not claimed.
- Judge B and Display B remained on CADET/R2/H2; no cross-podium change observed.
- A judge routing PASS; B isolation PASS.
- Start mutation count = 1; unexpected writes/storm/qualification mutation = none observed.

FINAL VERDICT: **PASS — PODIUM A R1H1 START CERTIFIED**
