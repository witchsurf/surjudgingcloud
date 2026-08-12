# P2.7.23 — Podium / active heat propagation

1. Runtime: Mac Field was started at `192.168.1.74:8080`; the probe completed.
2. Runtime identity: startup script reports `surfjudging-2026.08.12-p2.7.22-division-first-available-heat`, while in-app diagnostics report `frontendBuild: unreleased`; this identity mismatch remains to resolve.
3. Admin probe: event_id `10`, competition `MAMELLES OPEN`; A exposes `mamelles_open_open_r2_h1`, B exposes `mamelles_open_open_r1_h4`.
4. Judge A contexts J1/J2/J3 retained their real identities and `podium=A`.
5. Judge A diagnostics: `active-heat:10:podium:A` subscribed, polling disabled; heat config subscribed.
6. Display A diagnostics: `active-heat:10:podium:A` subscribed, polling disabled; heat signals/config subscribed.
7. Display rendered `MAMELLES OPEN · OPEN R2 H1` with the matching lineup and zero scores.
8. Static chain confirmed: podium-filtered pointer subscription → forced `loadConfigFromDb(..., podiumId)` → heat-scoped config.
9. Controlled transition executed at approximately `21:32:53` (Admin selected A `R2 H1 → R2 H2`; no save, close, score, or timer action).
10. Admin immediately exposed canonical A `mamelles_open_open_r2_h2` and reported `OPEN R2H2 diffusé`.
11. Judge A converged without reload by `21:33:24`: rendered `OPEN · R2 H2`.
12. Display A did not converge in the same observation window: at `21:34:07` it still rendered `OPEN R2 H1`.
13. Display localStorage already contained `heatId:2` at `21:33:20`, while its DOM and network hydration remained on `mamelles_open_open_r2_h1`.
14. First observed divergence: Display store/config changed, but Display render/hydration remained on the old heat. Realtime receipt and callback execution are not directly instrumented in this runtime.
15. Podium B remained `mamelles_open_open_r1_h4` in Admin during and after the A transition.
16. No code patch applied; no Mamelles/scoring/timer/DB data changed.
17. Verdict: PARTIALLY CERTIFIED — Judge propagation and A/B isolation confirmed; Display render convergence remains defective and requires a separate targeted patch audit.
