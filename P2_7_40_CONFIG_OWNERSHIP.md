# P2.7.40 — Config ownership audit

CONFIG OWNER: Zustand `useConfigStore` (`frontend/src/stores/configStore.ts`), consumed by `AdminPage`.

ONCONFIGCHANGE IMPLEMENTATION: `frontend/src/pages/AdminPage.tsx:190-210`, `handleConfigChange`; calls `setConfig(newConfig)` (whole-object replacement), then `persistConfig(newConfig)` (Zustand persist middleware).

UPDATE TYPE: child changes are **REPLACEMENT** at the parent boundary, not a merge. The `heatParticipants` effect at `AdminPage.tsx:228` is a merge (`setConfig(prev => ({...prev,...}))`) but writes lineup fields only.

PARENT REPLACEMENT PATHS: `configStore.loadConfigFromDb` final `set({ config: dbConfig, loadedFromDb:true, configSaved:true })` (~480); no-active-pointer/error paths replace with `INITIAL_CONFIG` plus event context (~235/390); `resetConfig` clears state. `AdminPage` initial URL/event effect invokes `loadConfigFromDb(... force:true, podiumId)` (~182). Podium reconnect invokes it (~456). `handlePodiumSwitch` invokes it (~330-352).

R2H3 source path: `active_heat_pointer` is read by `activeHeatPointerRepository.get` in `loadConfigFromDb` (~330-370); parsed pointer replaces snapshot division/round/heat_number, then `buildConfigFromSnapshot` and `set({config:dbConfig})` replace the parent config. Trigger: config load (initial URL, podium switch, reconnect, or store initialization). Can output current B R2H3: YES. Can run after division change: possible through an overlapping/explicit load, not proven in this audit.

W2 FULL OUTPUT: handler constructs `{...config, division:'OPEN', round:selected?.round, heatId:selected?.heat_number, ...}`. Thus `heatId` is updated to the selected heat number; no mixed `round=3/heat=2` with old numeric heatId was found in source.

PARENT STATE IMMEDIATELY AFTER W2: expected `OPEN/R3/H2`, with `heatId=2` (replacement via `setConfig(newConfig)`). PARENT STATE AFTER EFFECTS: not observed in a mounted parent test; a DB loader replacement could restore `OPEN/R2/H3`.

CONFIGSAVED: parent marks unsaved config dirty (`setConfigSaved(false)`), while DB loader sets `configSaved:true`; this is a potential ownership race but not proven to execute after W2.

Classification: **E — NO PARENT WRITER PROVEN / MODEL STILL INCOMPLETE**.
ROOT CAUSE PROVEN: **NO**.

NO PATCH
NO SAVE
NO DB MUTATION
