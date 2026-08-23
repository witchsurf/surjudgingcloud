# P2.7.35 — Config write trace

Runtime: `surfjudging-2026.08.13-p2.7.35-config-trace2`, Podium B, no SAVE.

DOM sequence after `OPEN → BENJAMIN` (2 s) → `OPEN`: R2H3 at T0, +100 ms, +500 ms, +1 s, +2 s, +5 s, +10 s. No H1/H2 oscillation occurred in this run.

| time | caller/function/line | old | new | podium | reason |
|---|---|---|---|---|---|
| 19:49:55.404 | AdminPage handleConfigChange, AdminPage bundle :69:54568; stack from AdminInterface `onChange` | OPEN/R2/H3 | BENJAMIN/R2/H1 | B | division selector |
| 19:49:57.425 | AdminPage handleConfigChange, same stack | BENJAMIN/R2/H1 | OPEN/R2/H3 | B | division selector |

Number of config writes: 2. First write after OPEN: `BENJAMIN/R2/H1` was the prior temporary selection; the OPEN write was second and directly produced `OPEN/R2/H3`. Writer of R2H1: division handler (temporary BENJAMIN selection). Writer of R2H3: division handler (OPEN selection). Writer of R3H2: none.

Classification: **A — division handler writes wrong value**.
Root cause proven: **YES** for this reproduction. No reconciliation overwrite, hydration write, pointer write, or async stale response was present in the boundary trace.

Instrumentation removed after capture. No behavior patch, SAVE, DB mutation, Judge/Display work, commit, or push.
