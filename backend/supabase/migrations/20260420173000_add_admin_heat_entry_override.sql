begin;

create table if not exists public.heat_entry_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id bigint,
  heat_id text not null,
  position integer not null,
  color text,
  previous_participant_id bigint,
  previous_participant_name text,
  new_participant_id bigint,
  new_participant_name text not null,
  new_country text,
  reason text,
  created_by text not null default 'chief_judge',
  created_at timestamptz not null default now()
);

create index if not exists heat_entry_overrides_heat_idx
  on public.heat_entry_overrides(heat_id, created_at desc);

alter table public.heat_entry_overrides enable row level security;

drop policy if exists heat_entry_overrides_public_read on public.heat_entry_overrides;
create policy heat_entry_overrides_public_read
  on public.heat_entry_overrides
  for select
  to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'heat_entries_heat_position_uk'
  ) then
    delete from public.heat_entries a
    using public.heat_entries b
    where a.heat_id = b.heat_id
      and a.position = b.position
      and a.id > b.id;

    create unique index heat_entries_heat_position_uk
      on public.heat_entries(heat_id, position);
  end if;
end $$;

create or replace function public.admin_override_heat_entry(
  p_heat_id text,
  p_position integer,
  p_color text default null,
  p_participant_id bigint default null,
  p_name text default null,
  p_country text default null,
  p_reason text default null,
  p_created_by text default 'chief_judge'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heat record;
  v_participant record;
  v_existing_participant_id bigint;
  v_existing_seed integer;
  v_existing_color text;
  v_existing_participant_name text;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_country text := nullif(trim(coalesce(p_country, '')), '');
  v_color text := nullif(upper(trim(coalesce(p_color, ''))), '');
  v_seed integer;
  v_surfers jsonb := '[]'::jsonb;
  v_surfer_names jsonb := '{}'::jsonb;
  v_surfer_countries jsonb := '{}'::jsonb;
  v_config_patch jsonb;
begin
  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'HEAT_ID_REQUIRED';
  end if;

  if p_position is null or p_position < 1 then
    raise exception 'POSITION_REQUIRED';
  end if;

  select h.id, h.event_id, h.division, h.round, h.heat_number, h.color_order
    into v_heat
  from public.heats h
  where h.id = trim(p_heat_id)
  limit 1;

  if not found then
    raise exception 'HEAT_NOT_FOUND:%', p_heat_id;
  end if;

  select he.participant_id, he.seed, he.color, p.name
    into v_existing_participant_id, v_existing_seed, v_existing_color, v_existing_participant_name
  from public.heat_entries he
  left join public.participants p on p.id = he.participant_id
  where he.heat_id = v_heat.id
    and he.position = p_position
  limit 1;

  v_color := coalesce(
    v_color,
    nullif(upper(trim(coalesce(v_existing_color, ''))), ''),
    nullif(upper(trim(coalesce(v_heat.color_order[p_position], ''))), '')
  );

  if p_participant_id is not null then
    select p.id, p.seed, p.name, p.country
      into v_participant
    from public.participants p
    where p.id = p_participant_id
      and (v_heat.event_id is null or p.event_id = v_heat.event_id)
    limit 1;

    if not found then
      raise exception 'PARTICIPANT_NOT_FOUND:%', p_participant_id;
    end if;
  else
    if v_name is null then
      raise exception 'PARTICIPANT_NAME_REQUIRED';
    end if;

    select p.id, p.seed, p.name, p.country
      into v_participant
    from public.participants p
    where (v_heat.event_id is null or p.event_id = v_heat.event_id)
      and lower(trim(coalesce(p.category, ''))) = lower(trim(coalesce(v_heat.division, '')))
      and lower(trim(coalesce(p.name, ''))) = lower(v_name)
    order by p.seed asc nulls last, p.id asc
    limit 1;

    if not found then
      select coalesce(max(p.seed), 0) + 1
        into v_seed
      from public.participants p
      where (v_heat.event_id is null or p.event_id = v_heat.event_id)
        and lower(trim(coalesce(p.category, ''))) = lower(trim(coalesce(v_heat.division, '')));

      insert into public.participants (event_id, category, seed, name, country, license)
      values (v_heat.event_id, v_heat.division, v_seed, v_name, v_country, null)
      returning id, seed, name, country
      into v_participant;
    end if;
  end if;

  insert into public.heat_entries (heat_id, participant_id, position, seed, color)
  values (
    v_heat.id,
    v_participant.id,
    p_position,
    coalesce(v_participant.seed, v_existing_seed, p_position),
    v_color
  )
  on conflict (heat_id, position) do update
    set participant_id = excluded.participant_id,
        seed = excluded.seed,
        color = coalesce(excluded.color, public.heat_entries.color);

  insert into public.heat_entry_overrides (
    event_id,
    heat_id,
    position,
    color,
    previous_participant_id,
    previous_participant_name,
    new_participant_id,
    new_participant_name,
    new_country,
    reason,
    created_by
  )
  values (
    v_heat.event_id,
    v_heat.id,
    p_position,
    v_color,
    v_existing_participant_id,
    v_existing_participant_name,
    v_participant.id,
    v_participant.name,
    coalesce(v_participant.country, v_country),
    nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(nullif(trim(coalesce(p_created_by, '')), ''), 'chief_judge')
  );

  with lineup as (
    select
      he.position,
      nullif(upper(trim(coalesce(he.color, v_heat.color_order[he.position], ''))), '') as color,
      p.name,
      p.country
    from public.heat_entries he
    left join public.participants p on p.id = he.participant_id
    where he.heat_id = v_heat.id
    order by he.position asc
  )
  select
    coalesce(jsonb_agg(color order by position) filter (where color is not null), '[]'::jsonb),
    coalesce(jsonb_object_agg(color, name) filter (where color is not null and name is not null), '{}'::jsonb),
    coalesce(jsonb_object_agg(color, country) filter (where color is not null and country is not null), '{}'::jsonb)
    into v_surfers, v_surfer_names, v_surfer_countries
  from lineup;

  v_config_patch := jsonb_build_object(
    'surfers', v_surfers,
    'surferNames', v_surfer_names,
    'surferCountries', v_surfer_countries,
    'surfersPerHeat', jsonb_array_length(v_surfers)
  );

  insert into public.heat_realtime_config (heat_id, config_data, updated_by)
  values (v_heat.id, v_config_patch, coalesce(nullif(trim(coalesce(p_created_by, '')), ''), 'chief_judge'))
  on conflict (heat_id) do update
    set config_data = coalesce(public.heat_realtime_config.config_data, '{}'::jsonb) || excluded.config_data,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return jsonb_build_object(
    'heat_id', v_heat.id,
    'position', p_position,
    'color', v_color,
    'participant_id', v_participant.id,
    'name', v_participant.name,
    'country', coalesce(v_participant.country, v_country),
    'config_patch', v_config_patch
  );
end;
$$;

grant select on table public.heat_entry_overrides to anon, authenticated, service_role;
grant execute on function public.admin_override_heat_entry(text, integer, text, bigint, text, text, text, text) to anon, authenticated, service_role;

commit;
