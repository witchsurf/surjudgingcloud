# P2.7.48 — Clean 60-second network baseline

WINDOW: `http://192.168.1.74:8080/admin?eventId=10`, fresh navigation T0, idle through T+60s (performance clock reached 75.862s; no target-family request occurred after the initial 0.756s burst).

TOTAL REQUESTS: 88 browser resource requests recorded in the clean page window (including static resources). Playwright performance entries expose no OPTIONS entries; preflight count is therefore 0 observed, not conflated with GETs.

| FAMILY | GET | OPTIONS | GET/MIN | PATTERN |
|---|---:|---:|---:|---|
| `active_heat_pointer` | 2 | 0 observed | 2 | initial burst at 0.260s, 0.537s; then idle |
| `heat_judge_assignments` | 3 | 0 observed | 3 | initial burst at 0.260s, 0.429s, 0.627s; then idle |
| `heats` | 11 | 0 observed | 11 | initial burst 0.259–0.756s; then idle |

Target-family timestamps (seconds from navigation):

- active pointer: `0.260, 0.537`
- judge assignments: `0.260, 0.429, 0.627`
- heats: `0.259, 0.259, 0.260, 0.261, 0.261, 0.402, 0.452, 0.550, 0.605, 0.685, 0.756`

EXPECTED CADENCE: event-driven for the three Admin effects; no timer. Realtime fallback is 30s local / 3s cloud where applicable, and Admin health is 15s but unrelated.

ACTUAL CADENCE: initial hydration burst only; zero target-family requests during the remainder of the 60-second idle window.

EXCESS FACTOR: none for idle traffic. `active_heat_pointer` 2, assignments 3, heats 11 are initial hydration reads, not periodic reads.

NETWORK STORM CONFIRMED: NO.

The earlier “thousands of requests” diagnosis came from accumulated Preserve-log history and cannot be used as a 10-second rate. No second control run was needed after the clean window showed zero ongoing target-family traffic.

ROOT CAUSE: NOT PROVEN. No source patch, SAVE, or DB mutation performed.
