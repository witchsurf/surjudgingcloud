# P2.7.19 — Display live switch + single-click SAVE

1. Runtime initially unavailable on `:8080`; previous P2.7.18 runtime had been deployed before this patch.
2. Display cause: active-pointer hydration could be deduped; the explicit transition now forces config hydration.
3. SAVE cause: `saveHeatConfig` reads event id from localStorage while `setActiveEventId` is asynchronous.
4. Red tests: targeted Display pointer and Admin single-click contract tests.
5. Files modified: `DisplayPage.tsx`, `AdminPage.tsx`; targeted tests added.
6. Patch: force pointer hydration; synchronously persist resolved event id before save chain.
7. Green tests: 4 targeted tests pass.
8. TypeScript and Field build pass.
9. Runtime deploy/manifest verification pending after container restart.
10. Playwright Display transition and single-click SAVE pending runtime availability.
11. Verdict: PARTIALLY CERTIFIED
