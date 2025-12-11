-- Add views and helper structures for competition workflow synchronisation

-- View of available divisions per event

create or replace view public.v_event_divisions as
select
  e.id   as event_id,
  e.name as event_name,
  p.category as division
from public.events e
join public.participants p
  on p.event_id = e.id
group by e.id, e.name, p.category
order by e.name, p.category;

-- Table storing the last saved configuration for each event
create table if not exists public.event_last_config (
  event_id    bigint primary key references public.events(id) on delete cascade,
  event_name  text        not null,
  division    text        not null,
  round       integer     not null default 1,
  heat_number integer     not null default 1,
  judges      jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default current_user
);

-- Upsert helper for event_last_config
create or replace function public.upsert_event_last_config(
  p_event_id    bigint,
  p_event_name  text,
  p_division    text,
  p_round       integer,
  p_heat_number integer,
  p_judges      jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.event_last_config (
    event_id,
    event_name,
    division,
    round,
    heat_number,
    judges,
    updated_at,
    updated_by
  )
  values (
    p_event_id,
    coalesce(p_event_name, ''::text),
    p_division,
    coalesce(p_round, 1),
    coalesce(p_heat_number, 1),
    coalesce(p_judges, '[]'::jsonb),
    now(),
    current_user
  )
  on conflict (event_id) do update
    set event_name  = excluded.event_name,
        division    = excluded.division,
        round       = excluded.round,
        heat_number = excluded.heat_number,
        judges      = excluded.judges,
        updated_at  = now(),
        updated_by  = current_user;
$$;

-- View exposing the current heat per event
create or replace view public.v_current_heat as
select
  a.event_name,
  e.id            as event_id,
  a.active_heat_id as heat_id,
  h.division,
  h.round,
  h.heat_number,
  h.status
from public.active_heat_pointer a
join public.heats h on h.id = a.active_heat_id
join public.events e on e.name = a.event_name;

-- View exposing participant line-up for a heat
create or replace view public.v_heat_lineup as
select
  h.id                as heat_id,
  h.event_id,
  coalesce(upper(he.color), upper(h.color_order[he.position]), '') as jersey_color,
  coalesce(p.name, hm.placeholder) as surfer_name,
  p.country,
  he.seed,
  he.position,
  hm.placeholder,
  hm.source_round,
  hm.source_heat,
  hm.source_position
from public.heats h
left join public.heat_entries he
  on he.heat_id = h.id
left join public.heat_slot_mappings hm
  on hm.heat_id = h.id
 and hm.position = coalesce(he.position, hm.position)
left join public.participants p
  on p.id = he.participant_id
order by h.id, coalesce(he.position, hm.position);

-- Function blocking scoring when the heat is not running
create or replace function public.fn_block_scoring_when_not_running()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select rc.status
    into v_status
  from public.heat_realtime_config rc
  where rc.heat_id = coalesce(new.heat_id, old.heat_id)
  limit 1;

  if v_status is distinct from 'running' then
    raise exception 'Saisie bloquée : heat non running (%)', coalesce(v_status, 'inconnu') using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_scores_insert on public.scores;
drop trigger if exists trg_block_scores_update on public.scores;

create trigger trg_block_scores_insert
  before insert on public.scores
  for each row
  execute function public.fn_block_scoring_when_not_running();

create trigger trg_block_scores_update
  before update on public.scores
  for each row
  execute function public.fn_block_scoring_when_not_running();

-- Function advancing to the next heat when the current one is closed/finished
create or replace function public.fn_advance_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id   bigint;
  v_event_name text;
  v_division   text;
  v_round      integer;
  v_heat_no    integer;
  v_next_id    text;
begin
  if tg_op = 'UPDATE'
     and new.status in ('finished','closed')
     and coalesce(old.status, '') <> new.status then

    update public.heats
       set status = 'closed'
     where id = new.heat_id
       and status <> 'closed';

    select h.event_id, h.competition, h.division, h.round, h.heat_number
      into v_event_id, v_event_name, v_division, v_round, v_heat_no
      from public.heats h
     where h.id = new.heat_id
     limit 1;

    select h.id
      into v_next_id
      from public.heats h
     where h.event_id = v_event_id
       and h.division = v_division
       and (
            (h.round = v_round and h.heat_number > v_heat_no)
         or (h.round = v_round + 1 and h.heat_number = 1)
       )
       and h.status in ('waiting','open')
     order by h.round asc, h.heat_number asc
     limit 1;

    if v_next_id is not null then
      update public.heats
         set status = 'open'
       where id = v_next_id;

      update public.heat_realtime_config
         set status = 'waiting',
             updated_at = now(),
             updated_by = current_user
       where heat_id = v_next_id;

      insert into public.active_heat_pointer(event_name, active_heat_id, updated_at)
      values (v_event_name, v_next_id, now())
      on conflict (event_name)
      do update set active_heat_id = excluded.active_heat_id,
                    updated_at      = excluded.updated_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_advance_on_finished on public.heat_realtime_config;
create trigger trg_advance_on_finished
  after update on public.heat_realtime_config
  for each row
  execute function public.fn_advance_on_close();

-- Ensure search_path is locked to public for helper functions
alter function public.fn_advance_on_close()                             set search_path = public;
alter function public.upsert_event_last_config(bigint,text,text,int,int,jsonb) set search_path = public;

-- Adjust RLS policies so anonymous clients can manage planning artefacts
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'heat_entries'
      and policyname = 'heat_entries_insert'
  ) then
    drop policy heat_entries_insert on public.heat_entries;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'heat_entries'
      and policyname = 'heat_entries_update'
  ) then
    drop policy heat_entries_update on public.heat_entries;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'heat_slot_mappings'
      and policyname = 'heat_slot_mappings_insert'
  ) then
    drop policy heat_slot_mappings_insert on public.heat_slot_mappings;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'heat_slot_mappings'
      and policyname = 'heat_slot_mappings_update'
  ) then
    drop policy heat_slot_mappings_update on public.heat_slot_mappings;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'participants'
      and policyname = 'participants_insert'
  ) then
    drop policy participants_insert on public.participants;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'participants'
      and policyname = 'participants_update'
  ) then
    drop policy participants_update on public.participants;
  end if;
end
$$;

create policy heat_entries_insert_all
  on public.heat_entries
  for insert
  to public
  with check (true);

create policy heat_entries_update_all
  on public.heat_entries
  for update
  to public
  using (true)
  with check (true);

create policy heat_slot_mappings_insert_all
  on public.heat_slot_mappings
  for insert
  to public
  with check (true);

create policy heat_slot_mappings_update_all
  on public.heat_slot_mappings
  for update
  to public
  using (true)
  with check (true);

create policy participants_insert_all
  on public.participants
  for insert
  to public
  with check (true);

create policy participants_update_all
  on public.participants
  for update
  to public
  using (true)
  with check (true);

-- Bulk upsert helper to persist heats, entries and participants atomically
create or replace function public.bulk_upsert_heats(
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_delete_ids text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if array_length(p_delete_ids, 1) is not null and array_length(p_delete_ids, 1) > 0 then
    delete from public.heat_slot_mappings where heat_id = any(p_delete_ids);
    delete from public.heat_entries where heat_id = any(p_delete_ids);
    delete from public.heat_realtime_config where heat_id = any(p_delete_ids);
    delete from public.heats where id = any(p_delete_ids);
  end if;

  if jsonb_array_length(p_participants) > 0 then
    insert into public.participants (event_id, category, seed, name, country, license)
    select event_id, category, seed, name, country, license
    from jsonb_to_recordset(p_participants)
      as t(event_id bigint, category text, seed int, name text, country text, license text)
    on conflict (event_id, category, seed) do update
      set name = excluded.name,
          country = excluded.country,
          license = excluded.license;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order)
    select id, event_id, competition, division, round, heat_number, heat_size, status, color_order
    from jsonb_to_recordset(p_heats)
      as t(id text, event_id bigint, competition text, division text, round integer, heat_number integer, heat_size integer, status text, color_order text[])
    on conflict (id) do update
      set event_id = excluded.event_id,
          competition = excluded.competition,
          division = excluded.division,
          round = excluded.round,
          heat_number = excluded.heat_number,
          heat_size = excluded.heat_size,
          status = excluded.status,
          color_order = excluded.color_order;
  end if;

  if jsonb_array_length(p_mappings) > 0 then
    insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    select heat_id, position, placeholder, source_round, source_heat, source_position
    from jsonb_to_recordset(p_mappings)
      as t(heat_id text, position integer, placeholder text, source_round integer, source_heat integer, source_position integer)
    on conflict (heat_id, position) do update
      set placeholder = excluded.placeholder,
          source_round = excluded.source_round,
          source_heat = excluded.source_heat,
          source_position = excluded.source_position;
  end if;

  if jsonb_array_length(p_entries) > 0 then
    insert into public.heat_entries (heat_id, participant_id, position, seed, color)
    select heat_id, participant_id, position, seed, color
    from jsonb_to_recordset(p_entries)
      as t(heat_id text, participant_id bigint, position integer, seed integer, color text)
    on conflict (heat_id, position) do update
      set participant_id = excluded.participant_id,
          seed = excluded.seed,
          color = excluded.color;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heat_realtime_config (heat_id)
    select id
    from jsonb_to_recordset(p_heats) as t(id text)
    on conflict (heat_id) do nothing;
  end if;
end;
$$;
