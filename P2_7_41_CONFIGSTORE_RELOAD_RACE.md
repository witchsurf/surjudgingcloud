# P2.7.41 — ConfigStore reload race audit

## loadConfigFromDb callsites

- `AdminPage.tsx:182` initial event/context effect; deps `eventIdFromUrl, activeEventId, loadedFromDb, loadConfigFromDb, setActiveEventId`; `force:true`, podium from persisted Admin podium; runs initial/context change, not ordinary division/round/heat change.
- `AdminPage.tsx:340` `handlePodiumSwitch`; explicit podium switch, `force:true`, podium argument; can run after navigation only if operator switches podium.
- `AdminPage.tsx:456` reconnect handler; explicit reconnect, no force, default/derived podium; not automatic division navigation.
- `JudgePage.tsx:156,201,325`, `DisplayPage.tsx:782`, `PriorityJudgePage.tsx:106,160`; other page lifecycles, not Admin parent effects.
- `configStore.ts:217,227,246` kiosk initialization wrappers; `602,613,622` store initialization/URL restoration; none are Admin division handlers.

## Automatic triggers

Admin `config` / `configSaved=false` / division / round / heat / heatId: **NO direct load**. `AdminPage.tsx:182` depends on URL/event/load state, not config fields or configSaved. `configSaved` only controls timer subscription (`AdminPage.tsx:372`). Active pointer refresh in `AdminInterface.tsx:728-754` only calls `setActivePodiumPointers`; it does not call `loadConfigFromDb`. Realtime/polling/online/focus do not call the Admin loader in the audited chain. Explicit reconnect/podium switch remain legitimate reloads.

## Pointer request origins

`AdminInterface.tsx:738` is a read-only pointer refresh (state only). `configStore.ts:312` is the DB-config replacement path, reached only from `loadConfigFromDb`. These are separate paths; repeated pointer reads alone do not prove config replacement.

## ConfigSaved ownership

`AdminPage.handleConfigChange` performs `setConfig(newConfig)` then marks dirty with `setConfigSaved(false)` when structurally changed. No Admin effect interprets `configSaved=false` as a DB restore. Store loader sets `configSaved:true` only when explicitly invoked.

## Controlled parent/store model

After W2: `OPEN/R3/H2`, numeric `heatId=2`. In the Admin ownership model, no dependency changed by this callback invokes `loadConfigFromDb`; therefore `LOADCONFIGFROMDB CALLED: NO`, final parent state remains `OPEN/R3/H2`. Explicit initial load/podium switch/reconnect legitimately may restore B pointer `OPEN/R2/H3`.

Classification: **E — loadConfigFromDb DOES NOT RUN; ELIMINATED** for ordinary Admin division navigation.
Root cause proven: **NO**.

NO PATCH
NO SAVE
NO DB MUTATION
