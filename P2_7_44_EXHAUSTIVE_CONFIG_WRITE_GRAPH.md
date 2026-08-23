# P2.7.44 — Exhaustive config write graph

TOTAL CONFIG WRITERS FOUND: 18 direct `setConfig`/`set({config:...})` sites plus 14 indirect `setConfig` callback sites in the frontend search.
TOTAL STORE WRITERS: 9 in `configStore.ts` (initial/reset, kiosk, DB snapshot replacement, persistence, save/reset paths).
TOTAL INDIRECT CALLERS: AdminPage, JudgePage, DisplayPage, PriorityJudgePage, MyEvents, OverlayPage, GenerateHeatsPage, App.new, useHeatManager, realtime/offline helpers.
TOTAL SUBSCRIPTIONS: Realtime callbacks in `useRealtimeSync`, `sharedRealtimeSubscriptions`, `vpsRealtime`, plus storage/offline event paths; Admin’s own pointer refresh only sets `activePodiumPointers`.

SYNCHRONOUS DIVISION CHANGE CHAIN: `AdminInterface.tsx:4583` select onChange → `handleConfigChange('division')` (`2232`) → target `planned` filter/sort → active/status filters → `onConfigChange({...config, division:value, round:selected.round, heatId:selected.heat_number})` (`2267`) → `AdminPage.handleConfigChange` (`190`) → Zustand `setConfig(newConfig)`.

W2 SELECTED: `OPEN/R3/H2`.
OBJECT PASSED TO onConfigChange: spread of current config with `division='OPEN'`, `round=3`, `heatId=2`, lineup reset; competition/judges retained.
OBJECT RECEIVED BY setConfig: same full object in `AdminPage.handleConfigChange`.
FIRST RENDERED CONFIG: statically `OPEN/R3/H2`.

WRITERS CAPABLE OF R2H3:

| Writer | Source | Trigger | Proof |
|---|---|---|---|
| ConfigStore snapshot replacement | `stores/configStore.ts:312-480` | explicit `loadConfigFromDb` / active pointer | Can build B `R2H3`; not triggered by Admin division change in audited deps |
| Judge/Display page loaders | `JudgePage.tsx`, `DisplayPage.tsx:782` | page lifecycle/pointer realtime | Can replace global Zustand config if mounted; not Admin-only proof |
| MyEvents restore | `MyEvents.tsx:645-708` | event selection/resume | Can replace snapshot config; no Admin transition caller |
| `useHeatManager` | `hooks/useHeatManager.ts:662` | heat close/advance | Writes a next heat, not ordinary division navigation |
| Overlay/Priority writers | `OverlayPage.tsx`, `PriorityJudgePage.tsx` | separate routes/priority actions | Can write global config, not proven concurrent with Admin |

SETCONFIG CALLER TESTS: source-level inputs show only ConfigStore DB replacement and separate-route loaders can directly reconstruct current B `R2H3`; Admin W2/W5/parent paths do not. No source-mapped breakpoint was used; no sourcemap/runtime instrumentation was added.

Classification: **F — NO WRITER FOUND / MODEL INCOMPLETE**.
ROOT CAUSE PROVEN: **NO**.

NO PATCH
NO SAVE
NO DB MUTATION
