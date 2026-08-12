# P2.7.17B — Podium B event context

1. Cause: the unassigned-podium branch reset the complete config to `INITIAL_CONFIG`, erasing `competition`.
2. File/function: `frontend/src/stores/configStore.ts`, `loadConfigFromDb`.
3. Red test: added `configStore.podiumBContext.contract.test.ts` for the unassigned Podium B branch.
4. Minimal patch: preserve event display name and division while resetting heat-specific config and `configSaved`.
5. Green test: targeted contract test passes.
6. TypeScript: `npx tsc --noEmit` passes.
7. Build: `npm run build:field` passes.

Manual point remaining: switch from Mamelles Podium A to an unassigned Podium B without clicking SAVE; verify event id 10, `MAMELLES OPEN`, and a later canonical heat id `mamelles_open_<division>_rX_hY`.
