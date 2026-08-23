# P2.7.59 — Dual podium E2E certification

FIELD_HOST: `10.0.0.10`
RELEASE: `surfjudging-2026.08.14-p2.7.58-admin-reload-hydration`
REVISION: `2507f3141552b07a139089df1c4a33c8d893f92b`
BUNDLE MATCH: YES (`AdminPage-B9NmIVhe.js`, `JudgePage-X7ZYsP94.js`, `DisplayPage-B2Oi0Msv.js`)

INITIAL A: `mamelles_open_benjamin_r2_h1`
INITIAL B: `mamelles_open_open_r2_h3`

A SAVE: PASS — one click, destination `mamelles_open_cadet_r1_h1`; B unchanged.
B SAVE: PASS — one click, destination `mamelles_open_open_r3_h2`; A unchanged.
PODIUM INDEPENDENCE: PASS at pointer level.
JUDGE EXCLUSIVITY: NOT COMPLETED.
SCORE FLOW: NOT RUN.
WAVE ORDER JUDGE: NOT RUN.
WAVE ORDER ADMIN: NOT RUN.
INTERFERENCE: NOT RUN.
OVERRIDE: NOT RUN.
HEAT CLOSE: NOT RUN.
QUALIFICATION: NOT RUN.
NEXT HEAT: NOT RUN.
DIVISION CHANGE: NOT RUN as a separate certification.
ROUND ADVANCE: NOT RUN.

JUDGE AUTO REFRESH: FAIL — existing Judge B remained `OPEN/R2/H3` after DB B changed to `OPEN/R3/H2`.
DISPLAY AUTO REFRESH: NOT RUN after first failing stage.
30S STABILITY: NOT RUN.

FIRST FAILING STAGE: Judge B live convergence after B SAVE.
No scores, START, close, qualification, or repair actions were performed.

FINAL VERDICT: BLOCKED — Judge auto-refresh failure.
