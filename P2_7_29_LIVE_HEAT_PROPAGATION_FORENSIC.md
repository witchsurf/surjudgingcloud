# P2.7.29 — Live heat propagation forensic test

Runtime: `surfjudging-2026.08.12-p2.7.28-runtime-aligned`; served SHA `89b7c28fd38a35ab6f67f03b7e821631babe3063`.

Authoritative DB state before transition (event 10):
- Podium A: `mamelles_open_open_r3_h1` (updated `2026-08-12 23:33:47.220173+00`)
- Podium B: `mamelles_open_open_r2_h3` (updated `2026-08-12 23:31:35.586628+00`)
- OPEN R2: H1 `closed`, H2 `closed`, H3 `open`.

No safe available OPEN R2 destination exists: H1/H2 are closed and H3 is occupied by B. Per the no-close/no-result-mutation contract, no Admin transition was executed.

| STAGE | JUDGE B | DISPLAY B |
|---|---|---|
| Initial DOM matches DB | NOT OBSERVED | NOT OBSERVED |
| Realtime channel SUBSCRIBED | NOT OBSERVED | NOT OBSERVED |
| hasPolling=false before | NOT OBSERVED | NOT OBSERVED |
| DB destination pointer | NOT OBSERVED | COMMON NOT OBSERVED |
| Realtime UPDATE received | NOT OBSERVED | NOT OBSERVED |
| Pointer callback entered | NOT OBSERVED | NOT OBSERVED |
| Destination heatId extracted | NOT OBSERVED | NOT OBSERVED |
| Config load started | NOT OBSERVED | NOT OBSERVED |
| Destination config returned | NOT OBSERVED | NOT OBSERVED |
| State became destination | NOT OBSERVED | NOT OBSERVED |
| Old subscriptions removed | NOT OBSERVED | NOT OBSERVED |
| New subscriptions active | NOT OBSERVED | NOT OBSERVED |
| DOM became destination | NOT OBSERVED | NOT OBSERVED |
| Propagation source | NOT OBSERVED | NOT OBSERVED |
| hasPolling=false after | NOT OBSERVED | NOT OBSERVED |
| Stable after 30 sec | NOT OBSERVED | NOT OBSERVED |

FIRST BROKEN STAGE JUDGE B: NOT OBSERVED.
FIRST BROKEN STAGE DISPLAY B: NOT OBSERVED.
COMMON FAILURE LAYER: UNPROVEN.

No screenshots or transition evidence were produced. NO PATCH APPLIED. No scores, START, close, or DB mutation performed.
Verdict: ROOT CAUSE LAYER NOT PROVEN.

Follow-up on OPEN Round 3: DB showed A=`mamelles_open_open_r3_h1`, B=`mamelles_open_open_r2_h3`; OPEN R3 H1/H2 were open. Admin selected Podium B → OPEN R3, then normal SAVE was required but failed with alert: `Sauvegarde impossible : La configuration du heat n’a pas pu être sauvegardée.` No pointer update occurred; no Judge/Display transition was attempted. Stop condition: first broken stage Admin SAVE → DB, propagation not observed.
