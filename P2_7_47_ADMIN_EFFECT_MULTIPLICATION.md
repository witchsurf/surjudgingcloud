# P2.7.47 — Runtime effect multiplication proof

## Static mount audit

- `AdminPage` is mounted once by the `/admin` route in `frontend/src/App.tsx`.
- `AdminInterface` is rendered once by `AdminPage.tsx` (line ~460). `App.new.tsx` contains a separate legacy composition, but it is not used by the active router.
- No `AdminLayout` mount was found.
- Field bootstrap wraps `<App />` in `React.StrictMode` (`main.tsx:93`). This can double-invoke mount effects in development, not generate thousands of continuous requests in a production Field build.

## Storm effects and dependencies

| Effect | Dependencies | Cleanup / guard | Direct query |
|---|---|---|---|
| Event assignments | `[activeEventId, selectedPodiumId, podiumAssignStatus]` | cancellation flag; no AbortController | `listEventAssignments` → `heats(id)` + `heat_judge_assignments.in(...)` |
| Event heat metadata | `[activeEventId, config.division, config.round, config.heatId]` | cancellation flag; no AbortController | `heats` event metadata |
| Active pointers | `[activeEventId, selectedPodiumId, podiumAssignStatus, config.heatId]` | cancellation flag; no AbortController | `active_heat_pointer` |

`activeEventId`, `selectedPodiumId`, and the config scalar fields are primitive. `podiumAssignStatus` is an object state value, and `activePodiumPointers` is an array used by the auto-assignment effect; those identities change when their setters receive new data. The auto-assignment effect depends on `activePodiumPointers`, `allEventHeatsMeta`, `judgeAssignmentStatus`, config fields and writes `podiumAssignStatus`, creating a proven re-entry edge. The three read effects themselves do not contain timers.

## Other active callers on Admin

- `useHeatParticipants(currentHeatId)`: `heat_entries`, `heat_slot_mappings`, and source `heats` reads; reload timeout is throttled (120 ms / 400 ms guard), subscription-driven.
- `useRealtimeSync().subscribeToHeat(currentHeatId)`: heat realtime snapshot reads `heat_realtime_config` and `heats`; fallback polling is 30 s local / 3 s cloud, one registry entry per heat.
- `useEventHeats` is not imported by `AdminPage`/`AdminInterface`.
- Analytics effect in `AdminInterface` is conditional on `analyticsScope === 'event'`; it reads scores, summaries, `heats(id)`, and overrides, but has no polling.
- PDF/export handlers are user actions only.

Repository caller counts for the three observed families on the Admin route: `listEventAssignments` = 1 effect; direct `active_heat_pointer` read = 1 effect; event metadata `heats` read = 1 effect. The assignment function itself performs two HTTP reads by design.

## Retry / cadence

No generic retry wrapper was found around these reads. Realtime retry logic applies to heat channels, with bounded backoff and the polling intervals above. StrictMode explains at most a mount/unmount duplicate.

The supplied Chrome sample (10 s window) implies approximately `active_heat_pointer`: 324.7 filtered requests/s (1,684.6 total/s), `heats`: 452.8 filtered/s (1,753 total/s); the exact `heat_judge_assignments` count was not supplied. This is far above every intended cadence and cannot be explained by the isolated 60 s harness (1 initial + 1 status-transition read).

## Controlled test / conclusion

`AdminNetworkStorm.contract.test.tsx` mounts the smallest status-dependent effect and advances fake timers 60 s: exactly two reads, then zero. Thus the isolated effect is not a continuous timer storm. The static graph proves a status/pointer re-entry multiplier, but not the thousands-request runtime amplification or a complete mount loop.

**REQUESTS/SECOND:** supplied evidence ≈ 324.7 pointer filtered/s; 452.8 heats filtered/s; assignment exact count unavailable.

**PATTERN:** high-rate continuous (based on the supplied idle-window evidence).

**ADMININTERFACE INSTANCE COUNT:** 1 active route instance.

**STORM EFFECT RUN COUNT:** not observable from static source; isolated harness = 2.

**DUPLICATE CALLERS:** one direct caller per family on Admin; assignment call expands to two requests.

**FIRST MULTIPLIER:** `podiumAssignStatus` / active-pointer re-entry edge.

**CLASSIFICATION:** G — MODEL STILL INCOMPLETE.

**ROOT CAUSE PROVEN: NO.** No production patch, SAVE, or DB mutation performed.
