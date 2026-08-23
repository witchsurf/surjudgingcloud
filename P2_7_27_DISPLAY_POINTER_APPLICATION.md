# P2.7.27 — Display pointer application

1. Reproduction used MAMELLES OPEN / OPEN / R2, B `R2H2 → R2H3` via normal Admin SAVE.
2. Realtime channels remained `SUBSCRIBED`, `hasPolling:false`.
3. Judge B localStorage/config changed to `heatId:3`; heat subscriptions switched to `mamelles_open_open_r2_h3` without reload.
4. Display B localStorage/config also changed to `heatId:3`; heat subscriptions switched to H3.
5. Display B accessibility DOM did not render `R2 H3` (live heading/content remained absent/stale), despite store/subscription H3.
6. First broken stage: React/rendered DOM after store/config and subscription convergence.
7. This confirms P2.7.24 remains functionally unresolved; no patch was applied in this chantier.
8. The remaining A rotations were stopped immediately per instruction.
9. No score, START, close, or qualification operation occurred.
10. Regression test, patch, build, deployment and Git commit were not performed.
11. Verdict: BLOCKED — Display render does not certify pointer propagation even though Realtime and store converge.
