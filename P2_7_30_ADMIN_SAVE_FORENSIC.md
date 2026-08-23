# P2.7.30 — Admin SAVE forensic (evidence only)

| Stage | Value |
|---|---|
| Event | MAMELLES OPEN (event_id 10) |
| Podium | B |
| Division / round | OPEN / R3 |
| Heat selected | R3H1 (proven by selects and GET `round=3&heat_number=1`) |
| Canonical heatId | `mamelles_open_open_r3_h1` |
| Planned heat id | `mamelles_open_open_r3_h1` |
| Current pointers | A=`mamelles_open_open_r3_h1`; B=`mamelles_open_open_r2_h3` |
| Heat active on other podium? | YES (R3H1 on A) |
| configSaved before SAVE | false |
| Judges selected | J1 NGALLA (`1ef05b77-8ce6-4090-a309-96bc666af22f`), J2 MAMADOU (`e98d47da-fee5-478b-a0cd-9365f455d5e5`), J3 KHADIOU (`65210ea2-fb72-4692-adf3-5d8b0cdcb5b5`) |
| First network failure | `POST /rest/v1/heat_judge_assignments?...on_conflict=heat_id,station` |
| HTTP status | 400 |
| DB/PostgREST code | `23514` |
| Raw error message | `Judge NGALLA is already assigned to active podium B heat mamelles_open_open_r2_h3` |
| Throwing function | `HeatRepository.saveHeatConfig` assignment upsert; propagated via `AdminPage` persistence path and `AdminInterface.handleSaveConfig` |
| Pointer changed? | NO |

The UI auto-selected R3H1 (first available by planning/status), even though A owns it. The first failing operation was the judge-assignment upsert: the selected judges are still assigned to B's active R2H3, so backend protection rejects before pointer activation. The user-facing alert translated this original error; no second click was made.

FIRST BROKEN STAGE: ADMIN SAVE → heat_judge_assignments DB upsert
EXACT RAW ERROR: PostgreSQL `23514`: Judge NGALLA is already assigned to active podium B heat mamelles_open_open_r2_h3
CLASSIFICATION: C — JUDGE ASSIGNMENT CONFLICT
ROOT CAUSE PROVEN: YES
NO PATCH APPLIED
