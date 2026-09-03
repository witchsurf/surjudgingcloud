begin;

-- `heat_realtime_config` drives the timer, but legacy/admin planning reads
-- `heats.status`. Keep both canonical representations aligned on each timer
-- transition so a successfully started heat is never reported as "open".
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
declare
  v_heat_id text := trim(p_heat_id);
  v_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  if v_heat_id = '' then raise exception 'heat_id is required'; end if;
  insert into public.heat_realtime_config (heat_id,status,timer_start_time,timer_duration_minutes,config_data,updated_at,updated_by)
  values (v_heat_id,coalesce(v_status,'waiting'),case when p_set_timer_start_time then p_timer_start_time end,case when p_set_timer_duration then p_timer_duration_minutes end,case when p_set_config_data then p_config_data end,now(),coalesce(nullif(trim(coalesce(p_updated_by,'')),''),current_user))
  on conflict (heat_id) do update set status=coalesce(v_status,heat_realtime_config.status),timer_start_time=case when p_set_timer_start_time then p_timer_start_time else heat_realtime_config.timer_start_time end,timer_duration_minutes=case when p_set_timer_duration then p_timer_duration_minutes else heat_realtime_config.timer_duration_minutes end,config_data=case when p_set_config_data then p_config_data else heat_realtime_config.config_data end,updated_at=now(),updated_by=coalesce(nullif(trim(coalesce(p_updated_by,'')),''),heat_realtime_config.updated_by,current_user);
  if v_status in ('waiting','running','paused','finished','closed') then update public.heats set status=v_status,updated_at=now() where id=v_heat_id and status is distinct from v_status; end if;
end;
$$;

commit;
