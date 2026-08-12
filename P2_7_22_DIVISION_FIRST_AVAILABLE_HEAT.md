# P2.7.22 — Division first available heat

1. Cause: division changes previously updated only `division`, leaving the old round/heat until later effects reconciled it.
2. Function: `AdminInterface.handleConfigChange`.
3. Red tests: targeted division-selection contract tests added for planning-derived selection and no inheritance.
4. Patch: on division change, filter/sort real planned heats, choose first non-closed heat, otherwise first planned heat, with R1H1 fallback only when planning is unavailable.
5. Heat-specific surfers/names/countries are cleared; event and podium remain unchanged.
6. Tests green: 2 targeted tests pass.
7. `npx tsc --noEmit`: passed.
8. `npm run build:field`: passed.
9. Manual test remaining: switch ONDINE U16 R2H1 → OPEN and verify the selected planned first available OPEN heat without SAVE.
