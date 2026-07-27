begin;

-- Keep this migration deployable on Cloud environments where the field-only
-- runtime diagnostics migration was not previously installed.
create table if not exists public.app_runtime_schema_version (
  id boolean primary key default true,
  schema_version text not null,
  schema_label text,
  updated_at timestamptz not null default now(),
  constraint app_runtime_schema_version_singleton check (id)
);

alter table public.app_runtime_schema_version enable row level security;

drop policy if exists allow_public_read_app_runtime_schema_version
  on public.app_runtime_schema_version;
create policy allow_public_read_app_runtime_schema_version
  on public.app_runtime_schema_version
  for select
  to anon, authenticated
  using (true);

grant select on public.app_runtime_schema_version to anon, authenticated;

-- The former realtime-config trigger performs a global, single-podium transition.
-- Multi-podium transitions are now exclusively owned by the explicit RPCs below:
-- this prevents closing podium A from advancing or rewriting podium B.
drop trigger if exists trg_unified_heat_transition on public.heat_realtime_config;
drop trigger if exists trg_advance_on_finished on public.heat_realtime_config;
drop trigger if exists trg_auto_transition_heats on public.heat_realtime_config;
drop trigger if exists trg_normalize_close on public.heat_realtime_config;
drop trigger if exists trg_gala_ondine_auto_transition on public.heat_realtime_config;

create table if not exists public.podium_judge_assignments (
  event_id bigint not null references public.events(id) on delete cascade,
  podium_id text not null,
  station text not null,
  judge_id text not null,
  judge_name text not null,
  assigned_at timestamptz not null default now(),
  assigned_by text,
  updated_at timestamptz not null default now(),
  primary key (event_id, podium_id, station),
  constraint podium_judge_assignments_podium_check
    check (trim(podium_id) <> '' and podium_id = upper(trim(podium_id))),
  constraint podium_judge_assignments_station_check check (trim(station) <> ''),
  constraint podium_judge_assignments_judge_id_check check (trim(judge_id) <> ''),
  constraint podium_judge_assignments_judge_name_check check (trim(judge_name) <> '')
);

create unique index if not exists idx_podium_judges_official_identity_once
  on public.podium_judge_assignments (event_id, lower(trim(judge_id)))
  where trim(judge_id) !~* '^J[0-9]+$';

create index if not exists idx_podium_judges_event_podium
  on public.podium_judge_assignments (event_id, podium_id, station);

alter table public.podium_judge_assignments enable row level security;

drop policy if exists podium_judge_assignments_read on public.podium_judge_assignments;
create policy podium_judge_assignments_read
  on public.podium_judge_assignments
  for select
  to anon, authenticated
  using (true);

grant select on public.podium_judge_assignments to anon, authenticated;
grant all on public.podium_judge_assignments to service_role;

drop trigger if exists update_podium_judge_assignments_updated_at on public.podium_judge_assignments;
create trigger update_podium_judge_assignments_updated_at
before update on public.podium_judge_assignments
for each row execute function public.update_updated_at_column();

create or replace function public.set_podium_judge_panel(
  p_event_id bigint,
  p_podium_id text,
  p_assignments jsonb,
  p_assigned_by text default 'admin'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_assignment jsonb;
  v_station text;
  v_judge_id text;
  v_judge_name text;
  v_count integer := 0;
begin
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event % not found', p_event_id using errcode = '23503';
  end if;

  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'p_assignments must be a JSON array' using errcode = '22023';
  end if;

  delete from public.podium_judge_assignments
  where event_id = p_event_id
    and podium_id = v_podium_id;

  for v_assignment in
    select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_station := upper(trim(coalesce(v_assignment ->> 'station', '')));
    v_judge_id := trim(coalesce(v_assignment ->> 'judge_id', v_assignment ->> 'judgeId', ''));
    v_judge_name := trim(coalesce(v_assignment ->> 'judge_name', v_assignment ->> 'judgeName', ''));

    if v_station = '' or v_judge_id = '' or v_judge_name = '' then
      raise exception 'Invalid podium judge assignment: %', v_assignment using errcode = '22023';
    end if;

    insert into public.podium_judge_assignments (
      event_id,
      podium_id,
      station,
      judge_id,
      judge_name,
      assigned_by
    )
    values (
      p_event_id,
      v_podium_id,
      v_station,
      v_judge_id,
      v_judge_name,
      nullif(trim(coalesce(p_assigned_by, '')), '')
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'A podium panel must contain at least one judge' using errcode = '23514';
  end if;

  return v_count;
end;
$$;

create or replace function public.copy_podium_panel_to_heat(
  p_event_id bigint,
  p_podium_id text,
  p_heat_id text,
  p_assigned_by text default 'podium-panel'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat_id text := trim(coalesce(p_heat_id, ''));
  v_count integer;
begin
  if not exists (
    select 1 from public.heats
    where id = v_heat_id
      and event_id = p_event_id
  ) then
    raise exception 'Heat % does not belong to event %', v_heat_id, p_event_id using errcode = '23503';
  end if;

  select count(*)::integer
    into v_count
  from public.podium_judge_assignments
  where event_id = p_event_id
    and podium_id = v_podium_id;

  if v_count = 0 then
    raise exception 'No judge panel configured for podium %', v_podium_id using errcode = '23514';
  end if;

  delete from public.heat_judge_assignments assignment
  where assignment.heat_id = v_heat_id
    and not exists (
      select 1
      from public.podium_judge_assignments panel
      where panel.event_id = p_event_id
        and panel.podium_id = v_podium_id
        and upper(trim(panel.station)) = upper(trim(assignment.station))
    );

  insert into public.heat_judge_assignments (
    heat_id,
    event_id,
    station,
    judge_id,
    judge_name,
    assigned_by
  )
  select
    v_heat_id,
    p_event_id,
    panel.station,
    panel.judge_id,
    panel.judge_name,
    coalesce(nullif(trim(p_assigned_by), ''), 'podium-panel')
  from public.podium_judge_assignments panel
  where panel.event_id = p_event_id
    and panel.podium_id = v_podium_id
  on conflict (heat_id, station)
  do update set
    event_id = excluded.event_id,
    judge_id = excluded.judge_id,
    judge_name = excluded.judge_name,
    assigned_by = excluded.assigned_by,
    updated_at = now();

  return v_count;
end;
$$;

create or replace function public.activate_heat_on_podium(
  p_event_id bigint,
  p_podium_id text,
  p_heat_id text,
  p_assigned_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat record;
  v_panel_size integer;
begin
  select id, competition, division, round, heat_number, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id)
    and event_id = p_event_id
  for update;

  if not found then
    raise exception 'Heat % does not belong to event %', p_heat_id, p_event_id using errcode = '23503';
  end if;

  if coalesce(v_heat.status, '') = 'closed' then
    raise exception 'Closed heat % cannot be activated', v_heat.id using errcode = '23514';
  end if;

  v_panel_size := public.copy_podium_panel_to_heat(
    p_event_id,
    v_podium_id,
    v_heat.id,
    p_assigned_by
  );

  perform public.upsert_active_heat_pointer(
    p_event_id,
    v_heat.competition,
    v_heat.id,
    now(),
    v_podium_id
  );

  update public.heats
     set status = case when status = 'waiting' then 'open' else status end,
         is_active = true,
         updated_at = now()
   where id = v_heat.id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'podium_id', v_podium_id,
    'heat_id', v_heat.id,
    'division', v_heat.division,
    'round', v_heat.round,
    'heat_number', v_heat.heat_number,
    'panel_size', v_panel_size
  );
end;
$$;

create or replace function public.close_heat_on_podium(
  p_event_id bigint,
  p_podium_id text,
  p_heat_id text,
  p_next_heat_id text default null,
  p_closed_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat record;
  v_pointer_heat_id text;
  v_qualifier_slots integer := 0;
  v_rebuilt_slots integer := 0;
  v_next jsonb := null;
begin
  select id, division, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id)
    and event_id = p_event_id
  for update;

  if not found then
    raise exception 'Heat % does not belong to event %', p_heat_id, p_event_id using errcode = '23503';
  end if;

  select active_heat_id
    into v_pointer_heat_id
  from public.active_heat_pointer
  where event_id = p_event_id
    and podium_id = v_podium_id
  for update;

  if v_pointer_heat_id is distinct from v_heat.id then
    raise exception 'Heat % is not active on podium % (active: %)', v_heat.id, v_podium_id, coalesce(v_pointer_heat_id, 'none')
      using errcode = '23514';
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now()),
         is_active = false,
         updated_at = now()
   where id = v_heat.id;

  insert into public.heat_realtime_config (
    heat_id,
    status,
    timer_start_time,
    updated_at,
    updated_by
  )
  values (
    v_heat.id,
    'closed',
    null,
    now(),
    coalesce(nullif(trim(p_closed_by), ''), 'admin')
  )
  on conflict (heat_id)
  do update set
    status = 'closed',
    timer_start_time = null,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  v_qualifier_slots := public.fn_propagate_qualifiers_for_source_heat(v_heat.id);
  v_rebuilt_slots := public.rebuild_division_qualifiers_from_scores(p_event_id, v_heat.division);

  if nullif(trim(coalesce(p_next_heat_id, '')), '') is not null then
    v_next := public.activate_heat_on_podium(
      p_event_id,
      v_podium_id,
      trim(p_next_heat_id),
      p_closed_by
    );
  end if;

  return jsonb_build_object(
    'event_id', p_event_id,
    'podium_id', v_podium_id,
    'closed_heat_id', v_heat.id,
    'qualifier_slots_updated', v_qualifier_slots,
    'division_slots_rebuilt', v_rebuilt_slots,
    'next', v_next
  );
end;
$$;

grant execute on function public.set_podium_judge_panel(bigint, text, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.copy_podium_panel_to_heat(bigint, text, text, text) to anon, authenticated, service_role;
grant execute on function public.activate_heat_on_podium(bigint, text, text, text) to anon, authenticated, service_role;
grant execute on function public.close_heat_on_podium(bigint, text, text, text, text) to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260727090000_podium_panels_and_atomic_heat_transitions', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
