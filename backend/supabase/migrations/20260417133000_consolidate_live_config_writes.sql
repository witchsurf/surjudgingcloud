begin;

create or replace function public.upsert_active_heat_pointer(
  p_event_id bigint default null,
  p_event_name text default null,
  p_active_heat_id text default null,
  p_updated_at timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_name text := nullif(trim(coalesce(p_event_name, '')), '');
  v_active_heat_id text := nullif(trim(coalesce(p_active_heat_id, '')), '');
begin
  if v_active_heat_id is null then
    raise exception 'active_heat_id is required';
  end if;

  if p_event_id is not null then
    update public.active_heat_pointer
       set event_id = p_event_id,
           event_name = coalesce(v_event_name, event_name),
           active_heat_id = v_active_heat_id,
           updated_at = coalesce(p_updated_at, now())
     where event_id = p_event_id;

    if found then
      return;
    end if;
  end if;

  if v_event_name is not null then
    update public.active_heat_pointer
       set event_id = coalesce(p_event_id, event_id),
           event_name = v_event_name,
           active_heat_id = v_active_heat_id,
           updated_at = coalesce(p_updated_at, now())
     where lower(trim(event_name)) = lower(trim(v_event_name));

    if found then
      return;
    end if;
  end if;

  insert into public.active_heat_pointer (
    event_id,
    event_name,
    active_heat_id,
    updated_at
  )
  values (
    p_event_id,
    coalesce(v_event_name, ''),
    v_active_heat_id,
    coalesce(p_updated_at, now())
  );
end;
$$;

grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz) to anon;
grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz) to authenticated;
grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz) to service_role;

create or replace function public.upsert_heat_realtime_config(
  p_heat_id text,
  p_status text default null,
  p_set_timer_start_time boolean default false,
  p_timer_start_time timestamptz default null,
  p_set_timer_duration boolean default false,
  p_timer_duration_minutes numeric default null,
  p_set_config_data boolean default false,
  p_config_data jsonb default null,
  p_updated_by text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'heat_id is required';
  end if;

  insert into public.heat_realtime_config (
    heat_id,
    status,
    timer_start_time,
    timer_duration_minutes,
    config_data,
    updated_at,
    updated_by
  )
  values (
    trim(p_heat_id),
    coalesce(nullif(trim(coalesce(p_status, '')), ''), 'waiting'),
    case when p_set_timer_start_time then p_timer_start_time else null end,
    case when p_set_timer_duration then p_timer_duration_minutes else null end,
    case when p_set_config_data then p_config_data else null end,
    now(),
    coalesce(nullif(trim(coalesce(p_updated_by, '')), ''), current_user)
  )
  on conflict (heat_id) do update
    set status = coalesce(nullif(trim(coalesce(p_status, '')), ''), heat_realtime_config.status),
        timer_start_time = case
          when p_set_timer_start_time then p_timer_start_time
          else heat_realtime_config.timer_start_time
        end,
        timer_duration_minutes = case
          when p_set_timer_duration then p_timer_duration_minutes
          else heat_realtime_config.timer_duration_minutes
        end,
        config_data = case
          when p_set_config_data then p_config_data
          else heat_realtime_config.config_data
        end,
        updated_at = now(),
        updated_by = coalesce(nullif(trim(coalesce(p_updated_by, '')), ''), heat_realtime_config.updated_by, current_user);
end;
$$;

grant execute on function public.upsert_heat_realtime_config(text, text, boolean, timestamptz, boolean, numeric, boolean, jsonb, text) to anon;
grant execute on function public.upsert_heat_realtime_config(text, text, boolean, timestamptz, boolean, numeric, boolean, jsonb, text) to authenticated;
grant execute on function public.upsert_heat_realtime_config(text, text, boolean, timestamptz, boolean, numeric, boolean, jsonb, text) to service_role;

drop policy if exists "Authenticated users can manage active heat pointer" on public.active_heat_pointer;
drop policy if exists "Everyone can view active heat pointer" on public.active_heat_pointer;
drop policy if exists "active_heat_pointer_read_all" on public.active_heat_pointer;
drop policy if exists "active_heat_pointer_write_authenticated" on public.active_heat_pointer;
drop policy if exists "allow_public_read_active_pointer" on public.active_heat_pointer;
drop policy if exists "anon_upsert_active_heat_pointer" on public.active_heat_pointer;

create policy "public can read active_heat_pointer"
  on public.active_heat_pointer
  for select
  to public
  using (true);

drop policy if exists "Users can manage config for their events" on public.event_last_config;
drop policy if exists "Users can view config for their events" on public.event_last_config;
drop policy if exists "event_last_config_public_read" on public.event_last_config;
drop policy if exists "event_last_config_public_write" on public.event_last_config;
drop policy if exists "event_last_config_read_own" on public.event_last_config;
drop policy if exists "event_last_config_write_own" on public.event_last_config;

create policy "public can read event_last_config"
  on public.event_last_config
  for select
  to public
  using (true);

drop policy if exists "Anyone can read heat_realtime_config" on public.heat_realtime_config;
drop policy if exists "Only event owners can insert heat_realtime_config" on public.heat_realtime_config;
drop policy if exists "Only event owners can update heat_realtime_config" on public.heat_realtime_config;
drop policy if exists "Public can read heat_realtime_config" on public.heat_realtime_config;
drop policy if exists "Users can manage realtime config for their events" on public.heat_realtime_config;
drop policy if exists "Users can view heat realtime config" on public.heat_realtime_config;
drop policy if exists "allow_public_read_heat_realtime" on public.heat_realtime_config;
drop policy if exists "heat_realtime_config_insert_auth" on public.heat_realtime_config;
drop policy if exists "heat_realtime_config_public_read" on public.heat_realtime_config;
drop policy if exists "heat_realtime_config_public_write" on public.heat_realtime_config;
drop policy if exists "heat_realtime_config_update_auth" on public.heat_realtime_config;
drop policy if exists "heat_realtime_config_upsert_public" on public.heat_realtime_config;

create policy "public can read heat_realtime_config"
  on public.heat_realtime_config
  for select
  to public
  using (true);

commit;
