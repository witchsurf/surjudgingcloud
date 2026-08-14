# P2.7.72 — Restore Field DB access + exhaustive ranking

HOST FIELD ACCESS: PROVEN BY OPERATOR (`10.0.0.10`, Field release P2.7.67). CODEX HTTP/Docker access remains sandbox-blocked; this is not evidence that Field is down.
FIELD IDENTITY: `surfjudging_kong:8000` → `surfjudging_postgres:5432`, confirmed by `infra/docker-compose-local.yml` and `scripts/start-surfjudging-field-mac.sh`. Do not use the independent `supabase_db_backend:54322` stack.
POSTGRES ACCESS: HOST-TERMINAL ONLY. `docker context show` = `colima`; Codex `docker ps` fails on the Colima socket permission. Operator handoff is required for migration/regressions.

BASELINE: HEAD `3b7a76da2ceb2b986cb12a17f6064581a3f7f16d`; worktree contains historical untracked reports and `.playwright-mcp/`; no source migration was changed.

HELPER: Implemented as a forward SQL migration using the preserved `fn_rank_heat_entries_scored_only` primitive plus exhaustive entry population. Lineage reads one `heat_slot_mappings` edge and invokes the score-only primitive, never the qualification wrapper.
RECURSION SAFETY: Static design is non-recursive for qualification; live SQL execution still required.
MIGRATION: `backend/supabase/migrations/20260814210000_exhaustive_heat_ranking_inherited_tiebreak.sql` created, not yet applied.
SCHEMA: NOT VERIFIED.
REGRESSION A-J: Not run in Codex. Read-only invariant script created at `backend/supabase/tests/p2_7_72_exhaustive_ranking.sql`; operator must run it plus the A–J matrix on `surfjudging_postgres`.
COMMIT: `bd7decf8859f07db31e1e5483af67ee168d9afe5` (`fix(db): rank all heat entries with inherited tiebreak`).
RELEASE: none.
FIELD_HOST: not discoverable in this session.
SOURCE == SERVED: NOT VERIFIED.
SCHEMA == EXPECTED: NOT VERIFIED.
BUNDLE MATCH: NOT VERIFIED.

R1H2 LIVE: not re-read. No scores or qualification data were touched.
READINESS: not called.
RANKING: not called.
QUALIFIERS: not calculated.
DESTINATIONS: not resolved.
CLOSE AUTHORIZED: NO.

PUSH STATUS: none.

OPERATOR PRECHECK:
```bash
cd "/Users/rene/Desktop/judging 2"
docker exec surfjudging_postgres psql -v ON_ERROR_STOP=1 -At -U postgres -d postgres -c "select current_database(),version();"
docker exec surfjudging_postgres psql -At -U postgres -d postgres -c "select schema_version from public.app_runtime_schema_version;"
```
No artificial scores, SAVE, START, CLOSE, migration, deployment, commit, or push performed.

OPERATOR MIGRATION: Applied to `surfjudging_postgres`; CADET R1H2 ranking returned 3 rows: RED participant 21 seed 9 total 8.17, WHITE participant 26 seed 14 total 0, YELLOW participant 29 seed 17 total 0.
REGRESSION INVARIANT: PASS after migration (`ranked=3`, `entries=3`; RED/WHITE/YELLOW all emitted).
LIVE READINESS: PASS for CADET R1H2 (`can_close=true`, blockers=[], score_count=3, missing_score_count=0, panel 3/3, lineup complete).
LIVE LINEAGE: R1H2 mappings are empty (directly seeded); previous totals NULL. Seed tie-break therefore predicts WHITE seed 14 > YELLOW seed 17.
R2 DESTINATIONS: R1H2 P1 → `mamelles_open_cadet_r2_h2` position 1; R1H2 P2 → `mamelles_open_cadet_r2_h1` position 3.
FINAL VERDICT: PARTIAL IMPLEMENTATION PASS — exhaustive ranking, readiness, destination mappings, and Git commit are confirmed; schema version, full A–J matrix, runtime alignment/push, and live client verification remain mandatory before CLOSE.
