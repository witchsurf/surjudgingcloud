-- AUDIT_POST_GENERATION_WORKFLOW.sql
-- Purpose: quick integrity audit right after participants import + heat generation.
--
-- Usage:
-- 1) Set ONE target below (event_id OR event_name), keep the other NULL.
-- 2) Run the whole script in Supabase SQL editor.
--
-- Expected outcome:
-- - heats / heat_entries / heat_slot_mappings exist and are coherent
-- - heat_realtime_config and active_heat_pointer align with generated heats
-- - event_last_config points to an existing heat

-- =========================
-- 0) Target Event Selector
-- =========================
with input as (
  select
    null::bigint as event_id,                  -- ex: 19
    null::text   as event_name                 -- ex: 'ligue_pro_1'
),
target_event as (
  select
    e.id as event_id,
    e.name as event_name
  from public.events e
  join input i
    on (i.event_id is not null and e.id = i.event_id)
    or (i.event_name is not null and lower(e.name) = lower(i.event_name))
  limit 1
)
select
  'TARGET_EVENT' as section,
  te.event_id,
  te.event_name
from target_event te;

-- ======================================
-- 1) Core Row Counts (post-generation)
-- ======================================
with input as (
  select null::bigint as event_id, null::text as event_name
),
target_event as (
  select e.id as event_id, e.name as event_name
  from public.events e
  join input i
    on (i.event_id is not null and e.id = i.event_id)
    or (i.event_name is not null and lower(e.name) = lower(i.event_name))
  limit 1
)
select 'participants' as item, count(*)::bigint as row_count
from public.participants p
join target_event te on p.event_id = te.event_id
union all
select 'heats' as item, count(*)::bigint as row_count
from public.heats h
join target_event te on h.event_id = te.event_id
union all
select 'heat_entries' as item, count(*)::bigint as row_count
from public.heat_entries he
join public.heats h on h.id = he.heat_id
join target_event te on h.event_id = te.event_id
union all
select 'heat_slot_mappings' as item, count(*)::bigint as row_count
from public.heat_slot_mappings hm
join public.heats h on h.id = hm.heat_id
join target_event te on h.event_id = te.event_id
union all
select 'heat_realtime_config' as item, count(*)::bigint as row_count
from public.heat_realtime_config rc
join public.heats h on h.id = rc.heat_id
join target_event te on h.event_id = te.event_id
union all
select 'event_last_config' as item, count(*)::bigint as row_count
from public.event_last_config ec
join target_event te on ec.event_id = te.event_id
union all
select 'scores' as item, count(*)::bigint as row_count
from public.scores s
join public.heats h on h.id = s.heat_id
join target_event te on h.event_id = te.event_id
order by item;

-- ====================================================
-- 2) Heat-by-Heat Coherence (entries/mappings/realtime)
-- ====================================================
with input as (
  select null::bigint as event_id, null::text as event_name
),
target_event as (
  select e.id as event_id
  from public.events e
  join input i
    on (i.event_id is not null and e.id = i.event_id)
    or (i.event_name is not null and lower(e.name) = lower(i.event_name))
  limit 1
),
per_heat as (
  select
    h.id as heat_id,
    h.round,
    h.heat_number,
    h.heat_size,
    count(distinct he.position) as entries_count,
    count(distinct hm.position) as mappings_count,
    max(case when rc.heat_id is not null then 1 else 0 end) as has_realtime
  from public.heats h
  left join public.heat_entries he on he.heat_id = h.id
  left join public.heat_slot_mappings hm on hm.heat_id = h.id
  left join public.heat_realtime_config rc on rc.heat_id = h.id
  join target_event te on h.event_id = te.event_id
  group by h.id, h.round, h.heat_number, h.heat_size
)
select
  heat_id,
  round,
  heat_number,
  heat_size,
  entries_count,
  mappings_count,
  has_realtime,
  case when entries_count = heat_size then 'OK' else 'MISMATCH' end as entries_vs_size,
  case when has_realtime = 1 then 'OK' else 'MISSING' end as realtime_status
from per_heat
order by round, heat_number;

-- ======================================
-- 3) Orphans / FK-like Inconsistencies
-- ======================================
-- 3a) heat_realtime_config rows without a heat row
select
  'orphan_realtime' as issue,
  rc.heat_id
from public.heat_realtime_config rc
left join public.heats h on h.id = rc.heat_id
where h.id is null
order by rc.heat_id;

-- 3b) heat_configs rows without a heat row
select
  'orphan_heat_config' as issue,
  hc.heat_id
from public.heat_configs hc
left join public.heats h on h.id = hc.heat_id
where h.id is null
order by hc.heat_id;

-- 3c) active pointer referencing a non-existing heat
select
  'broken_active_pointer' as issue,
  ap.event_name,
  ap.active_heat_id
from public.active_heat_pointer ap
left join public.heats h on h.id = ap.active_heat_id
where h.id is null;

-- ============================================
-- 4) Snapshot vs Heats Alignment (event config)
-- ============================================
with snapshots as (
  select
    ec.event_id,
    ec.event_name,
    ec.division,
    ec.round,
    ec.heat_number,
    lower(regexp_replace(ec.event_name, '[^a-z0-9]+', '_', 'g')) || '_' ||
      lower(regexp_replace(ec.division, '[^a-z0-9]+', '_', 'g')) || '_r' ||
      ec.round::text || '_h' || ec.heat_number::text as expected_heat_id
  from public.event_last_config ec
)
select
  s.event_id,
  s.event_name,
  s.division,
  s.round,
  s.heat_number,
  s.expected_heat_id,
  case when h.id is null then 'MISSING_HEAT' else 'OK' end as snapshot_alignment
from snapshots s
left join public.heats h on h.id = s.expected_heat_id
order by s.event_id;

-- ===========================================
-- 5) Optional: Heat ID Variant Collision Scan
-- ===========================================
-- Detect near-duplicates after rough normalization (spaces/underscores/typos patterns).
with all_ids as (
  select id as raw_id from public.heats
  union all
  select heat_id as raw_id from public.heat_realtime_config
  union all
  select heat_id as raw_id from public.heat_configs
),
normalized as (
  select
    raw_id,
    regexp_replace(lower(raw_id), '[^a-z0-9]+', '_', 'g') as normalized_id
  from all_ids
)
select
  normalized_id,
  count(distinct raw_id) as distinct_variants,
  string_agg(distinct raw_id, ' | ' order by raw_id) as variants
from normalized
group by normalized_id
having count(distinct raw_id) > 1
order by distinct_variants desc, normalized_id;

