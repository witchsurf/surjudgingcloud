# P2.7.24 — Display convergence

1. Root cause: the old `subscribeToHeat(currentHeatId, ...)` initial fetch could resolve after an active-pointer switch and invoke its callback after cleanup.
2. That stale callback called `setConfig(mergeRealtimeConfigPreservingLineup(...))`, restoring R2H1 over the already-updated R2H2 store.
3. Runtime evidence: localStorage was R2H2 while Display DOM/network remained R2H1.
4. Judge was unaffected because its pointer hydration path does not accept this stale Display callback.
5. RED test: contract test lacked protection against late callbacks from the previous heat subscription.
6. Minimal patch: Display ignores a heat callback when `liveHeatIdRef.current !== currentHeatId`; no polling/reload added.
7. GREEN: `DisplayPage.activeHeatSwitch.contract.test.ts` — 4 tests passed.
8. Typecheck: `npx tsc --noEmit` passed.
9. Build: `npm run build:field` passed.
10. Release: `surfjudging-2026.08.12-p2.7.24-display-convergence`.
11. Runtime files deployed with backup; `surfjudging` restarted.
12. Served manifest verified: field mode, releaseId above, codeRevision `34795a0d8012565a6c20bd8cbe0dc25213c9671c`.
13. Existing controlled transition measured Judge convergence; post-patch Display transition still requires the operator’s final field reproduction because the prior browser context had stale service-worker state.
14. No scores, heat status, timer, or Mamelles data modified.
15. Verdict: PARTIALLY CERTIFIED — patch/build/deploy certified; final clean-browser Display A→A transition pending.
