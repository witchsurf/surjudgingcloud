-- Ensure heat planning artefacts are correctly created and accessible

-- Update the public lineup view so it always falls back to placeholders
drop view if exists public.v_heat_lineup;
create view public.v_heat_lineup as
select
  h.id                as heat_id,
  h.event_id,
  coalesce(upper(he.color), upper(h.color_order[coalesce(he.position, hm.position)]), '') as jersey_color,
  coalesce(p.name, hm.placeholder) as surfer_name,
  p.country,
  he.seed,
  coalesce(he.position, hm.position) as position,
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

-- Reset permissive policies so anonymous clients can plan heats
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_entries' and policyname = 'heat_entries_insert_all'
  ) then
    drop policy heat_entries_insert_all on public.heat_entries;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_entries' and policyname = 'heat_entries_update_all'
  ) then
    drop policy heat_entries_update_all on public.heat_entries;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_slot_mappings' and policyname = 'heat_slot_mappings_insert_all'
  ) then
    drop policy heat_slot_mappings_insert_all on public.heat_slot_mappings;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_slot_mappings' and policyname = 'heat_slot_mappings_update_all'
  ) then
    drop policy heat_slot_mappings_update_all on public.heat_slot_mappings;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_insert_all'
  ) then
    drop policy participants_insert_all on public.participants;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_update_all'
  ) then
    drop policy participants_update_all on public.participants;
  end if;
end $$;

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

-- Helper to persist heats and their dependencies in one transaction
create or replace function public.bulk_upsert_heats(
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heat_ids text[];
begin
  if jsonb_array_length(p_heats) > 0 then
    select array_agg(id)
      into v_heat_ids
      from jsonb_to_recordset(p_heats) as t(id text);
  else
    v_heat_ids := array[]::text[];
  end if;

  if v_heat_ids is not null and array_length(v_heat_ids, 1) > 0 then
    delete from public.heat_slot_mappings where heat_id = any(v_heat_ids);
    delete from public.heat_entries where heat_id = any(v_heat_ids);
    delete from public.heat_realtime_config where heat_id = any(v_heat_ids);
    delete from public.heats where id = any(v_heat_ids);
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
    insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order, created_at)
    select id, event_id, competition, division, round, heat_number, heat_size, status, color_order, coalesce(created_at, now())
    from jsonb_to_recordset(p_heats)
      as t(id text, event_id bigint, competition text, division text, round integer, heat_number integer, heat_size integer, status text, color_order text[], created_at timestamptz)
    on conflict (id) do update set
      event_id    = excluded.event_id,
      competition = excluded.competition,
      division    = excluded.division,
      round       = excluded.round,
      heat_number = excluded.heat_number,
      heat_size   = excluded.heat_size,
      status      = excluded.status,
      color_order = excluded.color_order;
  end if;

  if jsonb_array_length(p_mappings) > 0 then
    insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    select heat_id, position, placeholder, source_round, source_heat, source_position
    from jsonb_to_recordset(p_mappings)
      as t(heat_id text, position integer, placeholder text, source_round integer, source_heat integer, source_position integer)
    on conflict (heat_id, position) do update set
      placeholder     = excluded.placeholder,
      source_round    = excluded.source_round,
      source_heat     = excluded.source_heat,
      source_position = excluded.source_position;
  end if;

  if jsonb_array_length(p_entries) > 0 then
    insert into public.heat_entries (heat_id, participant_id, position, seed, color)
    select heat_id, participant_id, position, seed, color
    from jsonb_to_recordset(p_entries)
      as t(heat_id text, participant_id bigint, position integer, seed integer, color text)
    on conflict (heat_id, position) do update set
      participant_id = excluded.participant_id,
      seed           = excluded.seed,
      color          = excluded.color;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heat_realtime_config (heat_id)
    select id
    from jsonb_to_recordset(p_heats) as t(id text)
    on conflict (heat_id) do nothing;
  end if;
end;
$$;
