# P2.7.70 — Partial-score close / inherited tiebreak contract

PHASE: READ-ONLY FORENSIC — no score, interference, SAVE, START, CLOSE, or DB mutation.

CURRENT READINESS DEFECT: The current `v_heat_missing_score_slots` view only starts checking a surfer/wave after a positive score exists, so a surfer with no attempted wave is not inherently a blocker. However, the readiness contract still needs live RPC verification; Field host `10.0.0.10` was unreachable during this phase.

NEW BUSINESS RULE: no-score surfer is a valid zero current-heat result; qualification must use current result, then previous-round total, then seed.

NO-SCORE SURFER SEMANTICS: current total 0, `HAS_CURRENT_SCORE=false`; must remain rankable and eligible for a qualification slot.
PARTIAL-PANEL SEMANTICS: an attempted wave with missing assigned judge rows remains structurally incomplete; the existing view detects this through `started_wave_slots` + `expected_judges`.

PREVIOUS ROUND TOTAL SOURCE: `heat_slot_mappings` (`source_round/source_heat/source_position`) resolved to the source heat and its canonical rank RPC. Directly seeded entries have NULL previous total.
SEED SOURCE: `heat_entries.seed`; lower seed is the deterministic fallback (the current ranking RPC otherwise falls back to color order).
RANK PRECEDENCE REQUIRED: current heat total DESC → previous-round total DESC → seed ASC → existing color/slot order.

CURRENT IMPLEMENTATION GAP: `fn_rank_heat_entries_from_scores` only emits surfers present in `wave_scores`; zero-score entries are omitted entirely. Therefore qualification cannot currently select a no-score surfer as rank 2/3. `fn_propagate_qualifiers_for_source_heat` consumes that incomplete ranking.

INTERFERENCE: `INT1` subtracts half of the second counting wave; `INT2` keeps the best wave; with zero/one counting wave the existing SQL uses COALESCE zero for the absent component. This behavior is preserved for the future DB fix.

CADET R1H2 CURRENT: ROUGE has complete J1/J2/J3 V1 rows (9.50/8/7) and INT1; BLANC/JAUNE have no current score. Existing expected aggregate is 8.17. Exact inherited totals/seed and `heat_slot_mappings` require fresh DB reads.

CAN_CLOSE: NOT CERTIFIED in this phase; no live RPC call was possible and no artificial scores were entered.
RANKING: RED is current-score leader; WHITE/YELLOW require previous-round/seed evidence before deterministic order can be reported.
QUALIFIERS: NOT PREDICTED — contract is not yet implemented in the authoritative ranking RPC.

DB FUNCTIONS TO CHANGE (future forward migration): `fn_rank_heat_entries_from_scores`, then readiness/propagation regression coverage. No production migration applied here.
REGRESSION MATRIX A–J: not executed; requires DB test harness and Field availability.

FINAL VERDICT: BLOCKED READ-ONLY — authoritative DB ranking currently omits no-score surfers, so CLOSE/qualification remain forbidden until a tested forward migration is implemented and deployed.
