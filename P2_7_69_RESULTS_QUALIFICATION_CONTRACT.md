# P2.7.69 — Results / qualification contract forensic

FIELD_HOST: `10.0.0.10` (rediscovery attempted; runtime currently unreachable from this session)
LAST CERTIFIED RELEASE: `surfjudging-2026.08.14-p2.7.67-display-post-dispatch-clean`
LAST CERTIFIED REVISION: `e19daf50f4e07bc3e0a90623fa8ad42c7ed97f58`
SOURCE == SERVED: last certified YES; current verification BLOCKED by host reachability.

## Contract inventory (read-only)

`AdminInterface` close button → `handleCloseHeat` → `closeHeatOnPodium` in `frontend/src/api/modules/heats.api.ts:1099` → strict RPC `close_heat_on_podium_strict`, fallback `close_heat_on_podium`.
The DB transaction locks the heat and active pointer, validates readiness, marks `heats.status='closed'`, upserts `heat_realtime_config.status='closed'`, propagates qualifiers, rebuilds division qualifiers, and optionally activates a supplied next heat.
Readiness is `fn_get_heat_close_readiness` (`20260727200000_add_strict_heat_close_readiness.sql:3`): missing score slots, unresolved lineup, incomplete panel, invalid/orphan scores block close.

RAW SCORE AUTHORITY: `scores` through `v_scores_canonical_enriched` (latest judge score per heat/color/wave/judge).
INTERFERENCE AUTHORITY: `interference_calls`, summarized by `fn_heat_interference_summary`.
FINAL RESULT/RANK AUTHORITY: DB RPC `fn_rank_heat_entries_from_scores`; no separate results table required.
Ranking formula: per-wave average (5+ judges drops min/max; otherwise mean), top two waves summed, rounded 2 decimals; INT1 subtracts half of second wave; INT2 keeps best wave; disqualified = 0; rank desc then color.

QUALIFICATION: `fn_propagate_qualifiers_for_source_heat` selects next-round heats and `heat_slot_mappings`, ranks source via `fn_rank_heat_entries_from_scores`, and writes destination `heat_entries`. `rebuild_division_qualifiers_from_scores` repeats this across the division. No `%qual%` table exists in the live schema listing.
CADET graph from DB: R1H1, R1H2, R1H3, R1H4 → R2H1/R2H2 → R3H1. Exact destination slots depend on `heat_slot_mappings`.
ROUND DEPENDENCY: close transaction can close one heat, but readiness/propagation is per source; whether all R1 heats must close is represented by mappings/rebuild, not a separate qualification table. This was not mutated or invoked.

## Current fixture prediction gate

CADET R1H2 remains OPEN; R1H1 remains OPEN on A. R1H2 has only ROUGE V1 scores (9.50/8/7) plus INT1; BLANC and JAUNE have missing score slots. Therefore `fn_get_heat_close_readiness` must return `can_close=false` (`MISSING_SCORES`), so no close is authorized.
Minimum complete ledger still requires waves for all three surfers across the configured panel; not entered in this read-only phase.

FINAL VERDICT: READ-ONLY CONTRACT FORENSIC COMPLETE; CLOSE/QUALIFICATION BLOCKED BY READINESS AND CURRENT FIELD HOST UNREACHABLE.
