# P2.7.80 — Podium B next-heat transition certification

## Runtime / scope

- Field host: `10.0.0.10:8080`; existing Playwright session reused.
- Event: MAMELLES OPEN (`event_id=10`), division CADET.
- No score, START, second close, manual DB edit, or mapping edit performed.

## Pre-transition

- A pointer: `mamelles_open_cadet_r1_h1` (open).
- B pointer: `mamelles_open_cadet_r1_h2` (closed).
- CADET heats: R1H1 open, R1H2 closed, R1H3 open, R1H4 open, R2H1 open, R2H2 open, R3H1 open.
- Mapping/lineage evidence made R2H2 the unique next eligible bracket heat: R1H2 P1 had materialized (participant 21/RED); R2H1 still had pending R1H1/R1H3/R1H4 feeders.
- Target before transition: `mamelles_open_cadet_r2_h2`, open; B judges NGALLA/MAMADOU/KHADIOU.

## Transition

- Admin selected Round 2 / Heat 2 for Podium B and used the normal single `SAUVEGARDER` action; no START.
- DB immediately after: A=`mamelles_open_cadet_r1_h1`; B=`mamelles_open_cadet_r2_h2`.
- Target remained open. Target entries: P21/seed9 RED; remaining positions retained null participants with WHITE/YELLOW/BLUE slots. Assignments remained J1/J2/J3 = NGALLA/MAMADOU/KHADIOU.

## Passive clients (no reload)

- Judge B converged to `CADET · R2 H2` without reload.
- Display B converged to `CADET · R2 H2` without reload.
- Podium A remained on R1H1.
- After 30 seconds: pointers unchanged; no stale return observed.
- Admin was reloaded once afterward and restored CADET/R2/H2.

## Verdict

`PODIUM B NEXT-HEAT TRANSITION CERTIFIED`
