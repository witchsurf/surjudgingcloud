# P2.7.42 — W2 stale-closure/data timing proof

## W2 closure inputs

`config`, `config.round`, `config.heatId`: React STATE/PROP from the BENJAMIN render; only used in the spread and fallback (`round:1`, `heatId:1`) plus current-heat exclusion.

`allEventHeatsMeta`: React STATE, async event-wide `heats` query; filtered by TARGET division OPEN.
`divisionHeatSequence` / `visibleRoundOptions`: not read by W2.
`activePodiumPointers`: React STATE, async pointer query; PODIUM-GLOBAL.
`selectedPodiumId`: state/prop only logged/used elsewhere; not used in candidate selection.
`authoritativeHeatStatusRef`: REF populated from event-wide heat metadata; EVENT-GLOBAL.
`pendingDivisionSelectionRef`: REF written after selection; not an input to W2.
`isHeatClosed`: not read by W2; `isLockedStatus` is applied to target rows using status/ref.

## Deterministic closure harness

The exact W2 algorithm was replayed without React rerender: current render division `BENJAMIN`, target `OPEN`, current B `R2H3`, A `R3H1`, current heat excluded.

| Variant | Current division | Input difference | W2 output |
|---|---|---|---|
| Fresh authoritative baseline | BENJAMIN | fresh OPEN metadata, fresh A/B pointers/statuses | OPEN/R3/H2 |
| Real BENJAMIN closure | BENJAMIN | handler invoked before rerender | OPEN/R3/H2 |
| A | BENJAMIN | fresh metadata + fresh pointers + BENJAMIN sequence | OPEN/R3/H2 |
| B | BENJAMIN | stale B pointer state (R2H3 absent) | OPEN/R3/H2 (current heat exclusion still applies) |
| C | BENJAMIN | incomplete OPEN metadata | first available row; if empty, fallback OPEN/R1/H1 |
| D | BENJAMIN | target OPEN absent from derived memos | W2 ignores memos; uses allEventHeatsMeta, so same as metadata variant |
| E | BENJAMIN | status helper based on current division | W2 uses authoritative status ref/row.status, not division-derived helper |
| F | BENJAMIN | pending ref pre-existing | W2 does not read pending ref; same candidate result |

No tested stale-closure variant produces `OPEN/R2/H3`. The only W2 fallback is `selected?.round ?? 1` / `selected?.heat_number ?? 1`; it preserves neither `config.round` nor `config.heatId`.

LIVE-TIMING W2 OUTPUT: `OPEN/R3/H2` under the exact source model.
INPUT CAUSING R2H3: none identified.
FALLBACK REACHED: only with empty target candidates, yielding R1/H1—not R2/H3.
EXACT SOURCE LOCATION: `AdminInterface.tsx:2232-2276`.

Classification: **E — W2 STILL RETURNS R3H2 UNDER LIVE-TIMING MODEL**
ROOT CAUSE PROVEN: **NO**

NO PATCH
NO SAVE
NO DB MUTATION
