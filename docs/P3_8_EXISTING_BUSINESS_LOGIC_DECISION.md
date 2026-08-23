# P3.8 existing business-logic decision

The mixed-format implementation reuses the existing SurfJudging path:

- authoritative propagation: `fn_propagate_qualifiers_for_source_heat`;
- authoritative lineage: `public.heat_slot_mappings`;
- odd-field correction: `fn_best_second_heat_entry_for_round` plus
  `maybePromoteBestSecond` in `frontend/src/utils/heatGeneration.ts`;
- Man-on-Man generation: the existing `buildManOnManBracket` implementation
  inside `heatGeneration.ts`.

P3.8 does not introduce a second ranking service, best-third rule, or mandatory
BYE resolver. `heat_progression_edges` remains optional experimental metadata;
it is not authoritative for progression.

For OPEN=20 with transition at Round 3, the accepted métier target is fourteen
real heats: five R1 heats, three R2 heats, three R3 Man-on-Man heats, two R4
semifinals and one final. The three R3 winners plus the existing `Meilleur 2e
R3` rule produce four R4 entrants. No BYE or synthetic heat is used.
