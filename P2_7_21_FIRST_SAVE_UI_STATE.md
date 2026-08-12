# P2.7.21 — First SAVE UI state

1. Confirmed fact: first canonical RPC returns HTTP 204; DB chain is not changed.
2. Cause: post-save lineup hydration could call the operator `onConfigChange` callback after `setConfigSaved(true)`.
3. That callback compares the hydrated config as a user edit and resets `configSaved=false`.
4. Direct path: `AdminInterface` selected-heat lineup effect → `onConfigChange` → `AdminPage.handleConfigChange`.
5. Patch: skip that internal lineup callback when `configSaved` is already true.
6. User edits still use `onConfigChange` and continue to mark the config dirty.
7. Targeted tests: 2 passed.
8. `npx tsc --noEmit`: passed.
9. `npm run build:field`: passed.
10. No RPC, scoring, timer, judge, or database code changed.
11. Runtime/Chrome first-click confirmation remains to be performed.

Verdict: PARTIALLY CERTIFIED
