-- Non-destructive performance audit for field-critical Supabase queries.
--
-- Usage:
--   1. Run this against the local HP database or Supabase SQL editor.
--   2. Replace the settings below with a real event_id / heat_id.
--   3. Review duplicate/unused indexes before dropping anything manually.

set app.audit_event_id = '1';
set app.audit_heat_id = 'replace_with_heat_id';

-- Exact duplicate indexes by indexed expression/predicate.
with index_defs as (
  select
    schemaname,
    tablename,
    indexname,
    regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX [^ ]+ ', 'CREATE INDEX ', 'i') as normalized_indexdef
  from pg_indexes
  where schemaname = 'public'
),
duplicates as (
  select
    schemaname,
    tablename,
    normalized_indexdef,
    array_agg(indexname order by indexname) as duplicate_indexes,
    count(*) as duplicate_count
  from index_defs
  group by schemaname, tablename, normalized_indexdef
  having count(*) > 1
)
select *
from duplicates
order by tablename, duplicate_indexes;

-- Low/no scan indexes. Treat small fresh databases carefully; this is a clue,
-- not a deletion order.
select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan asc, relname, indexrelname;

-- Field-critical query: ordered scores for one heat.
explain (analyze, buffers, verbose)
select
  id,
  event_id,
  heat_id,
  competition,
  division,
  round,
  judge_id,
  judge_name,
  judge_station,
  judge_identity_id,
  surfer,
  wave_number,
  score,
  timestamp,
  created_at
from public.scores
where heat_id = current_setting('app.audit_heat_id')
order by created_at asc;

-- Field-critical query: ordered heat entries / lineup for one heat.
explain (analyze, buffers, verbose)
select
  color,
  position,
  participant_id,
  seed
from public.heat_entries
where heat_id = current_setting('app.audit_heat_id')
order by position asc;

-- Admin/display query: heat structure for one event.
explain (analyze, buffers, verbose)
select
  division,
  round,
  heat_number
from public.heats
where event_id = current_setting('app.audit_event_id')::bigint
order by division asc, round asc, heat_number asc;

-- Accuracy reporting read. This should hit the materialized view index and stay
-- separate from live score writes.
explain (analyze, buffers, verbose)
select *
from public.v_event_judge_accuracy_summary
where event_id = current_setting('app.audit_event_id')::bigint
order by quality_score desc, mean_abs_deviation asc;
