# P2.7.43 — Admin state vs DOM

ROUND CONTROL VALUE SOURCE: `AdminInterface.tsx:4659-4661`, controlled `value={config.round}`, options `visibleRoundOptions`, `onChange` calls `handleConfigChange('round', Number(...))`.

HEAT CONTROL VALUE SOURCE: `AdminInterface.tsx:4677-4679`, controlled `value={config.heatId}`, options `visibleHeatOptions`, `onChange` calls `handleConfigChange('heatId', Number(...))`.

DIVISION CONTROL: `AdminInterface.tsx:4581-4584`, controlled `value={config.division}`.

CONTROLLED: YES. No `defaultValue`, no second selectedRound/selectedHeat state, no selector `key`, and no active-pointer fallback in JSX.

OPTION SOURCES: `visibleRoundOptions` derives from `divisionHeatSequence` (`2515-2519`); `visibleHeatOptions` derives from `divisionHeatSequence` filtered by `config.round` (`2530-2534`). During a transition, stale BENJAMIN sequence can temporarily omit OPEN R3/H2, but a controlled select with a missing value does not synthesize R2/H3; it renders no matching option/empty selection.

SECOND UI STATE FOUND: NO. `selectedHeat`, `currentHeatStatus`, and `currentHeatId` are derived/memoized values; only `config.round`/`config.heatId` feed the controls.

DOM HARNESS RESULT:

| CONFIG | ROUND OPTIONS | HEAT OPTIONS | DOM ROUND | DOM HEAT |
|---|---|---|---|---|
| OPEN/R3/H2 | [2,3,4] | [1,2] | 3 | 2 |
| OPEN/R3/H2 | [2,4] | [1] | controlled value absent (not 2/3) | controlled value absent (not 2) |
| OPEN/R2/H3 | [2,3,4] | [1,2,3] | 2 | 3 |

PLAYWRIGHT PREVIOUSLY MEASURED: `locator('select').evaluateAll(...slice(0,3).map(e => e.value))`; this reads the actual DOM select values, not React state or network data. Therefore `OPEN/R2/H3` means the rendered controls contained those values.

CONFIG R3H2 / DOM R2H3 POSSIBLE: **NO**, from the controlled JSX and option logic.

Classification: **D — DOM DIRECTLY REFLECTS CONFIG; R2H3 IS REAL STATE**.
ROOT CAUSE PROVEN: **YES** for eliminating a display-only mismatch; the upstream writer producing R2H3 remains unidentified.

NO PATCH
NO SAVE
NO DB MUTATION
