-- Offline/source-of-truth audit for Surf Judging
-- Goal:
-- 1. confirm which transition triggers are currently active
-- 2. detect event/heat drift across live tables
-- 3. verify the event can be reconstructed purely from Supabase state

-- ============================================================================
-- 1. ACTIVE TRIGGERS ON HEAT WORKFLOW
-- ============================================================================

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  p.proname as function_name,
  case
    when (t.tgtype & 2) <> 0 then 'BEFORE'
    else 'AFTER'
  end as timing,
  concat_ws(
    ',',
    case when (t.tgtype & 4) <> 0 then 'INSERT' end,
    case when (t.tgtype & 8) <> 0 then 'DELETE' end,
    case when (t.tgtype & 16) <> 0 then 'UPDATE' end,
    case when (t.tgtype & 32) <> 0 then 'TRUNCATE' end
  ) as events,
  t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname in ('heat_realtime_config', 'heats', 'scores', 'heat_judge_assignments', 'active_heat_pointer')
order by c.relname, t.tgname;

-- Expected:
-- - exactly one transition trigger on public.heat_realtime_config
-- - exactly one sync trigger on public.heats for status propagation
-- - scoring block triggers only on public.scores

-- ============================================================================
-- 2. ACTIVE FUNCTION DEFINITIONS TO REVIEW
-- ============================================================================

select
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_sql
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fn_unified_heat_transition',
    'fn_advance_on_close',
    'fn_sync_heat_status',
    'fn_block_scoring_when_closed',
    'fn_block_scoring_when_not_running'
  )
order by p.proname;

-- ============================================================================
-- 3. HEAT ID / EVENT ID DRIFT CHECKS
-- ============================================================================

-- Scores whose event_id disagrees with their heat
select
  s.id,
  s.heat_id,
  s.event_id as score_event_id,
  h.event_id as heat_event_id,
  s.competition,
  s.division,
  s.round,
  s.wave_number,
  s.judge_station,
  s.surfer
from public.scores s
join public.heats h on h.id = s.heat_id
where s.event_id is distinct from h.event_id
order by s.created_at desc;

-- Judge assignments whose event_id disagrees with their heat
select
  a.id,
  a.heat_id,
  a.event_id as assignment_event_id,
  h.event_id as heat_event_id,
  a.station,
  a.judge_name
from public.heat_judge_assignments a
join public.heats h on h.id = a.heat_id
where a.event_id is distinct from h.event_id
order by a.updated_at desc;

-- Active heat pointers whose event_id disagrees with the pointed heat
drop table if exists temp_active_heat_pointer_drift;

create temp table temp_active_heat_pointer_drift (
  pointer_event_id bigint,
  pointer_event_name text,
  active_heat_id text,
  heat_event_id bigint,
  competition text,
  division text,
  round integer,
  heat_number integer
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'active_heat_pointer'
      and column_name = 'event_id'
  ) then
    execute $sql$
      insert into temp_active_heat_pointer_drift (
        pointer_event_id,
        pointer_event_name,
        active_heat_id,
        heat_event_id,
        competition,
        division,
        round,
        heat_number
      )
      select
        p.event_id as pointer_event_id,
        p.event_name,
        p.active_heat_id,
        h.event_id as heat_event_id,
        h.competition,
        h.division,
        h.round,
        h.heat_number
      from public.active_heat_pointer p
      left join public.heats h on h.id = p.active_heat_id
      where h.id is null
         or p.event_id is distinct from h.event_id
    $sql$;
  else
    execute $sql$
      insert into temp_active_heat_pointer_drift (
        pointer_event_id,
        pointer_event_name,
        active_heat_id,
        heat_event_id,
        competition,
        division,
        round,
        heat_number
      )
      select
        null::bigint as pointer_event_id,
        p.event_name,
        p.active_heat_id,
        h.event_id as heat_event_id,
        h.competition,
        h.division,
        h.round,
        h.heat_number
      from public.active_heat_pointer p
      left join public.heats h on h.id = p.active_heat_id
      where h.id is null
    $sql$;
  end if;
end $$;

select *
from temp_active_heat_pointer_drift
order by active_heat_id;

-- ============================================================================
-- 4. LOGICAL DUPLICATE HEATS
-- ============================================================================

select
  event_id,
  lower(trim(coalesce(division, ''))) as division_key,
  round,
  heat_number,
  count(*) as duplicate_count,
  array_agg(id order by id) as heat_ids
from public.heats
group by event_id, lower(trim(coalesce(division, ''))), round, heat_number
having count(*) > 1
order by duplicate_count desc, event_id, division_key, round, heat_number;

-- ============================================================================
-- 5. LIVE TABLES REQUIRED FOR DISPLAY/JUDGE/ADMIN
-- ============================================================================

-- Heats missing realtime config row
select
  h.id,
  h.event_id,
  h.competition,
  h.division,
  h.round,
  h.heat_number,
  h.status
from public.heats h
left join public.heat_realtime_config rc on rc.heat_id = h.id
where rc.heat_id is null
order by h.event_id, h.division, h.round, h.heat_number;

-- Heats missing config row
select
  h.id,
  h.event_id,
  h.competition,
  h.division,
  h.round,
  h.heat_number
from public.heats h
left join public.heat_configs hc on hc.heat_id = h.id
where hc.heat_id is null
order by h.event_id, h.division, h.round, h.heat_number;

-- Heats missing lineup data in both heat_entries and event_last_config
with heat_entries_count as (
  select heat_id, count(*) as entry_count
  from public.heat_entries
  group by heat_id
),
snapshot_flags as (
  select
    event_id,
    lower(trim(coalesce(division, ''))) as division_key,
    round,
    heat_number,
    coalesce(array_length(surfers, 1), 0) as surfer_count
  from public.event_last_config
)
select
  h.id,
  h.event_id,
  h.competition,
  h.division,
  h.round,
  h.heat_number,
  coalesce(ec.entry_count, 0) as heat_entries_count,
  coalesce(sf.surfer_count, 0) as snapshot_surfer_count
from public.heats h
left join heat_entries_count ec on ec.heat_id = h.id
left join snapshot_flags sf
  on sf.event_id = h.event_id
 and sf.division_key = lower(trim(coalesce(h.division, '')))
 and sf.round = h.round
 and sf.heat_number = h.heat_number
where coalesce(ec.entry_count, 0) = 0
  and coalesce(sf.surfer_count, 0) = 0
order by h.event_id, h.division, h.round, h.heat_number;

-- ============================================================================
-- 6. OFFLINE SCORE RECOVERY READINESS
-- ============================================================================

-- Closed/finished heats with no scores on the canonical heat id
select
  h.id,
  h.event_id,
  h.competition,
  h.division,
  h.round,
  h.heat_number,
  h.status,
  count(s.id) as score_count
from public.heats h
left join public.scores s on s.heat_id = h.id
where h.status in ('finished', 'closed')
group by h.id, h.event_id, h.competition, h.division, h.round, h.heat_number, h.status
having count(s.id) = 0
order by h.event_id, h.division, h.round, h.heat_number;

-- ============================================================================
-- 7. QUICK EVENT-FOCUSED FILTER (edit the event id if needed)
-- ============================================================================

-- Replace 20 with the event under test
select
  h.id,
  h.event_id,
  h.competition,
  h.division,
  h.round,
  h.heat_number,
  h.status,
  coalesce(score_counts.score_count, 0) as score_count,
  coalesce(entry_counts.entry_count, 0) as entry_count,
  case when rc.heat_id is null then false else true end as has_realtime_row,
  case when hc.heat_id is null then false else true end as has_config_row
from public.heats h
left join (
  select heat_id, count(*) as score_count
  from public.scores
  group by heat_id
) score_counts on score_counts.heat_id = h.id
left join (
  select heat_id, count(*) as entry_count
  from public.heat_entries
  group by heat_id
) entry_counts on entry_counts.heat_id = h.id
left join public.heat_realtime_config rc on rc.heat_id = h.id
left join public.heat_configs hc on hc.heat_id = h.id
where h.event_id = 20
order by lower(trim(coalesce(h.division, ''))), h.round, h.heat_number;
