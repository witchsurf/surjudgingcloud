-- FIX_HEAT_ID_CANONICALIZATION_GLOBAL.sql
-- Global, event-agnostic hardening:
-- 1) Normalize/merge existing non-canonical heat IDs across all related tables
-- 2) Add DB functions + triggers so future writes are always canonical
--
-- Canonical rule:
--   lowercase + non [a-z0-9] => '_' + trim leading/trailing '_' + collapse repeats
--   Example: "LIGUE PRO ##1_OPEN_R1_H3" -> "ligue_pro_1_open_r1_h3"

begin;

-- =========================================================
-- A) Canonicalization function
-- =========================================================
create or replace function public.normalize_heat_id(p_raw text)
returns text
language sql
immutable
as $$
  select
    case
      when p_raw is null then null
      else regexp_replace(
        regexp_replace(lower(trim(p_raw)), '[^a-z0-9]+', '_', 'g'),
        '^_+|_+$',
        '',
        'g'
      )
    end
$$;

comment on function public.normalize_heat_id(text) is
  'Canonical heat id formatter: lowercase + non-alnum to underscore + trim/collapse underscores.';

-- =========================================================
-- B) Build global old_id -> new_id map (all heat_id carriers)
-- =========================================================
drop table if exists tmp_heat_id_map;
create temporary table tmp_heat_id_map as
with ids as (
  select id as raw_id from public.heats
  union
  select heat_id as raw_id from public.heat_realtime_config
  union
  select heat_id as raw_id from public.heat_configs
  union
  select heat_id as raw_id from public.heat_entries
  union
  select heat_id as raw_id from public.heat_slot_mappings
  union
  select heat_id as raw_id from public.scores
  union
  select heat_id as raw_id from public.score_overrides
  union
  select active_heat_id as raw_id from public.active_heat_pointer
)
select distinct
  raw_id as old_id,
  public.normalize_heat_id(raw_id) as new_id
from ids
where raw_id is not null
  and raw_id <> public.normalize_heat_id(raw_id);

do $$
begin
  raise notice 'heat_id variants to process: %', (select count(*) from tmp_heat_id_map);
end $$;

-- =========================================================
-- C) Ensure canonical heats exist before moving references
-- =========================================================
insert into public.heats (
  id, event_id, competition, division, round, heat_number, status,
  created_at, updated_at, closed_at, heat_size, color_order, is_active
)
select
  m.new_id,
  h.event_id,
  h.competition,
  h.division,
  h.round,
  coalesce(h.heat_number, coalesce((regexp_match(m.new_id, '_h([0-9]+)$'))[1]::int, 1)),
  h.status,
  coalesce(h.created_at, now()),
  now(),
  h.closed_at,
  h.heat_size,
  h.color_order,
  coalesce(h.is_active, true)
from tmp_heat_id_map m
join public.heats h on h.id = m.old_id
left join public.heats h2 on h2.id = m.new_id
where h2.id is null;

-- =========================================================
-- D) Move dependent rows to canonical IDs
-- =========================================================

-- heat_entries (unique by heat_id, position)
insert into public.heat_entries (heat_id, participant_id, position, seed, color, created_at)
select
  m.new_id, he.participant_id, he.position, he.seed, he.color, he.created_at
from tmp_heat_id_map m
join public.heat_entries he on he.heat_id = m.old_id
on conflict (heat_id, position) do update
set
  participant_id = excluded.participant_id,
  seed = excluded.seed,
  color = excluded.color;

delete from public.heat_entries he
using tmp_heat_id_map m
where he.heat_id = m.old_id;

-- heat_slot_mappings (unique by heat_id, position)
insert into public.heat_slot_mappings (
  heat_id, position, placeholder, source_round, source_heat, source_position, created_at
)
select
  m.new_id, hm.position, hm.placeholder, hm.source_round, hm.source_heat, hm.source_position, hm.created_at
from tmp_heat_id_map m
join public.heat_slot_mappings hm on hm.heat_id = m.old_id
on conflict (heat_id, position) do update
set
  placeholder = excluded.placeholder,
  source_round = excluded.source_round,
  source_heat = excluded.source_heat,
  source_position = excluded.source_position;

delete from public.heat_slot_mappings hm
using tmp_heat_id_map m
where hm.heat_id = m.old_id;

-- heat_realtime_config (PK heat_id)
insert into public.heat_realtime_config (
  heat_id, status, timer_start_time, timer_duration_minutes, config_data, updated_at, updated_by
)
select
  m.new_id, rc.status, rc.timer_start_time, rc.timer_duration_minutes, rc.config_data, rc.updated_at, rc.updated_by
from tmp_heat_id_map m
join public.heat_realtime_config rc on rc.heat_id = m.old_id
on conflict (heat_id) do update
set
  status = excluded.status,
  timer_start_time = excluded.timer_start_time,
  timer_duration_minutes = excluded.timer_duration_minutes,
  config_data = excluded.config_data,
  updated_at = greatest(public.heat_realtime_config.updated_at, excluded.updated_at),
  updated_by = excluded.updated_by;

delete from public.heat_realtime_config rc
using tmp_heat_id_map m
where rc.heat_id = m.old_id;

-- heat_configs (unique heat_id)
insert into public.heat_configs (
  heat_id, judges, surfers, judge_names, waves, tournament_type, created_at
)
select
  m.new_id, hc.judges, hc.surfers, hc.judge_names, hc.waves, hc.tournament_type, hc.created_at
from tmp_heat_id_map m
join public.heat_configs hc on hc.heat_id = m.old_id
on conflict (heat_id) do update
set
  judges = excluded.judges,
  surfers = excluded.surfers,
  judge_names = excluded.judge_names,
  waves = excluded.waves,
  tournament_type = excluded.tournament_type;

delete from public.heat_configs hc
using tmp_heat_id_map m
where hc.heat_id = m.old_id;

-- scores / overrides
update public.scores s
set heat_id = m.new_id
from tmp_heat_id_map m
where s.heat_id = m.old_id;

update public.score_overrides so
set heat_id = m.new_id
from tmp_heat_id_map m
where so.heat_id = m.old_id;

-- optional table: interference_calls
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'interference_calls'
  ) then
    execute '
      update public.interference_calls ic
      set heat_id = m.new_id
      from tmp_heat_id_map m
      where ic.heat_id = m.old_id
    ';
  end if;
end $$;

-- active pointer
update public.active_heat_pointer ap
set
  active_heat_id = m.new_id,
  updated_at = now()
from tmp_heat_id_map m
where ap.active_heat_id = m.old_id;

-- remove old heat ids
delete from public.heats h
using tmp_heat_id_map m
where h.id = m.old_id;

-- =========================================================
-- E) Enforce canonical IDs on future writes (DB triggers)
-- =========================================================

create or replace function public.trg_normalize_heat_id_heats()
returns trigger
language plpgsql
as $$
begin
  new.id := public.normalize_heat_id(new.id);
  return new;
end;
$$;

create or replace function public.trg_normalize_heat_id_ref()
returns trigger
language plpgsql
as $$
begin
  new.heat_id := public.normalize_heat_id(new.heat_id);
  return new;
end;
$$;

create or replace function public.trg_normalize_active_heat_pointer()
returns trigger
language plpgsql
as $$
begin
  new.active_heat_id := public.normalize_heat_id(new.active_heat_id);
  return new;
end;
$$;

drop trigger if exists trg_normalize_heats_id on public.heats;
create trigger trg_normalize_heats_id
before insert or update of id
on public.heats
for each row
execute function public.trg_normalize_heat_id_heats();

drop trigger if exists trg_normalize_heat_realtime_config_heat_id on public.heat_realtime_config;
create trigger trg_normalize_heat_realtime_config_heat_id
before insert or update of heat_id
on public.heat_realtime_config
for each row
execute function public.trg_normalize_heat_id_ref();

drop trigger if exists trg_normalize_heat_configs_heat_id on public.heat_configs;
create trigger trg_normalize_heat_configs_heat_id
before insert or update of heat_id
on public.heat_configs
for each row
execute function public.trg_normalize_heat_id_ref();

drop trigger if exists trg_normalize_heat_entries_heat_id on public.heat_entries;
create trigger trg_normalize_heat_entries_heat_id
before insert or update of heat_id
on public.heat_entries
for each row
execute function public.trg_normalize_heat_id_ref();

drop trigger if exists trg_normalize_heat_slot_mappings_heat_id on public.heat_slot_mappings;
create trigger trg_normalize_heat_slot_mappings_heat_id
before insert or update of heat_id
on public.heat_slot_mappings
for each row
execute function public.trg_normalize_heat_id_ref();

drop trigger if exists trg_normalize_scores_heat_id on public.scores;
create trigger trg_normalize_scores_heat_id
before insert or update of heat_id
on public.scores
for each row
execute function public.trg_normalize_heat_id_ref();

drop trigger if exists trg_normalize_score_overrides_heat_id on public.score_overrides;
create trigger trg_normalize_score_overrides_heat_id
before insert or update of heat_id
on public.score_overrides
for each row
execute function public.trg_normalize_heat_id_ref();

drop trigger if exists trg_normalize_active_heat_pointer_heat_id on public.active_heat_pointer;
create trigger trg_normalize_active_heat_pointer_heat_id
before insert or update of active_heat_id
on public.active_heat_pointer
for each row
execute function public.trg_normalize_active_heat_pointer();

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'interference_calls'
  ) then
    execute 'drop trigger if exists trg_normalize_interference_calls_heat_id on public.interference_calls';
    execute '
      create trigger trg_normalize_interference_calls_heat_id
      before insert or update of heat_id
      on public.interference_calls
      for each row
      execute function public.trg_normalize_heat_id_ref()
    ';
  end if;
end $$;

commit;

-- Quick check: should return zero rows once stabilized.
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
