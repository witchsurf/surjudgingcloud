-- Adjust bulk_upsert_heats signature to accept explicit deletions

create or replace function public.bulk_upsert_heats(
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_delete_ids text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
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
