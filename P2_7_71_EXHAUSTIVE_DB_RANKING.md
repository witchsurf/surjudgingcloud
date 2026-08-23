# P2.7.71 — Exhaustive DB heat ranking + inherited tiebreak

ROOT CAUSE: `fn_rank_heat_entries_from_scores` populates from `wave_scores`, so legitimate `heat_entries` with no current score are omitted. Qualification consumes this incomplete set.

OLD RANKING POPULATION: only positive-score surfer/wave aggregates.
NEW RANKING POPULATION (required): every legitimate `heat_entries` row exactly once, left-joined to current aggregates.
NO-SCORE SEMANTICS: current total 0, `has_current_score=false`; valid sporting result.
PARTIAL-PANEL SEMANTICS: an attempted wave is identified by `started_wave_slots`; missing configured judge rows remain a readiness blocker. Untouched surfers do not create missing slots.
PREVIOUS TOTAL RESOLUTION: `heat_slot_mappings` → source round/heat/position → canonical source result; direct seeds have NULL previous total. Must use a non-recursive score-total helper or bounded source lookup.
SEED RESOLUTION: `heat_entries.seed`, ascending NULLS LAST; lower seed is better.
FINAL ORDER BY: current total DESC, previous total DESC NULLS LAST, seed ASC NULLS LAST, stable color/slot fallback.
RECURSION SAFETY: not yet implemented; must be proven in the forward migration before deployment.

DB REGRESSION MATRIX: not run (Field/Postgres unavailable from this session). Required cases A–J from the task remain a hard gate.
READINESS: existing view semantics preserve no-attempt vs partial-panel distinction, but live RPC verification is pending.
QUALIFICATION: current propagation calls the incomplete ranking and therefore must wait for the new ranking RPC.
HISTORICAL REGRESSION: not run; no historical data touched.

MIGRATION: NOT APPLIED. No deployed migration history was edited.
SCHEMA VERSION: not changed.
COMMIT: none.
RELEASE: none.
FIELD_HOST: last known `10.0.0.10`; current manifest/DB verification unreachable.
SOURCE == SERVED: NOT VERIFIED.
SCHEMA == EXPECTED: NOT VERIFIED.
BUNDLE MATCH: NOT VERIFIED.

CADET R1H2 LIVE: not re-read in this phase. Existing known state remains ROUGE 9.50/8/7 + INT1, BLANC/JAUNE untouched.
READINESS: no live corrected RPC result.
RANKING: no live corrected RPC result.
QUALIFIERS: not predicted; no destination mutation.
DESTINATIONS: must be resolved from `heat_slot_mappings` after migration tests.
CLOSE AUTHORIZED: NO.

FINAL VERDICT: BLOCKED BEFORE IMPLEMENTATION — DB migration, regression matrix, Field schema migration, served identity verification, and live read-only gate are mandatory before any CADET close. No score, SAVE, START, CLOSE, or DB mutation performed.
