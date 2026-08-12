# P2.7.18 — Display auto heat switch

1. Cause: active-pointer callback called `loadConfigFromDb` without bypassing the config-store dedupe window.
2. File/function: `frontend/src/pages/DisplayPage.tsx`, `applyActiveHeatPointer`.
3. Red test: targeted active-heat switch contract test added before the production change.
4. Patch: pass `{ force: true, podiumId }` on explicit pointer changes; no reload or business-rule change.
5. Green test: 3 targeted tests pass.
6. Build: `npx tsc --noEmit` and `npm run build:field` pass.
7. Deploy: Field dist copied with backup; runtime restarted; served bundle/manifest verified.
8. Browser: runtime probe confirms Display/Admin load; full live Admin A→Display heat transition remains a manual Playwright confirmation.
9. Verdict: DISPLAY AUTO HEAT SWITCH STILL BROKEN (live A→B browser transition not certified)
