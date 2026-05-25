begin;

-- 1. Drop all legacy triggers and functions that cause premature auto-transitions
drop trigger if exists trg_advance_on_finished on public.heat_realtime_config;
drop trigger if exists trg_auto_transition_heats on public.heat_realtime_config;
drop trigger if exists trg_normalize_close on public.heat_realtime_config;
drop trigger if exists trg_gala_ondine_auto_transition on public.heat_realtime_config;
drop trigger if exists update_heat_realtime_config_trigger on public.heats;

drop function if exists public.fn_advance_on_close() cascade;
drop function if exists public.fn_advance_on_finished() cascade;
drop function if exists public.fn_auto_transition_all_events() cascade;
drop function if exists public.fn_gala_ondine_auto_transition() cascade;
drop function if exists public.fn_normalize_close() cascade;
drop function if exists public.trigger_close_heat_auto() cascade;

-- 2. Ensure unified transition trigger function is updated to only advance on manual 'closed' status
create or replace function public.fn_unified_heat_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event_id bigint;
  v_event_name text;
  v_division text;
  v_round integer;
  v_heat_no integer;
  v_next_heat_id text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Strictly lock progression to explicit 'closed' status changes (manual close).
  if new.status <> 'closed' then
    return new;
  end if;

  if coalesce(old.status, '') = new.status then
    return new;
  end if;

  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;

  select h.event_id, h.competition, h.division, h.round, h.heat_number
    into v_event_id, v_event_name, v_division, v_round, v_heat_no
    from public.heats h
   where h.id = new.heat_id
     for update nowait;

  if not found then
    return new;
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now())
   where id = new.heat_id
     and status <> 'closed';

  perform public.fn_propagate_qualifiers_for_source_heat(new.heat_id);

  select h.id
    into v_next_heat_id
    from public.heats h
   where h.event_id = v_event_id
     and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_division, '')))
     and h.id <> new.heat_id
     and h.status in ('waiting', 'open')
     and (
       (h.round = v_round and h.heat_number > v_heat_no)
       or (h.round > v_round)
     )
   order by h.round asc, h.heat_number asc
   limit 1
     for update skip locked;

  if v_next_heat_id is not null then
    insert into public.heat_realtime_config (
      heat_id,
      status,
      timer_start_time,
      updated_at,
      updated_by
    )
    values (
      v_next_heat_id,
      'waiting',
      null,
      now(),
      coalesce(new.updated_by, 'system')
    )
    on conflict (heat_id)
    do update set
      status = 'waiting',
      timer_start_time = null,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    update public.heats
       set status = 'open'
     where id = v_next_heat_id
       and status in ('waiting', 'open');

    insert into public.active_heat_pointer (
      event_id,
      event_name,
      active_heat_id,
      updated_at
    )
    values (
      v_event_id,
      v_event_name,
      v_next_heat_id,
      now()
    )
    on conflict (event_id)
    do update set
      event_name = excluded.event_name,
      active_heat_id = excluded.active_heat_id,
      updated_at = excluded.updated_at;
  end if;

  return new;
exception
  when lock_not_available then
    raise notice 'Heat transition skipped (locked): %', new.heat_id;
    return new;
  when others then
    raise warning 'Error in heat transition for %: %', new.heat_id, sqlerrm;
    return new;
end;
$$;

-- 3. Install trg_unified_heat_transition trigger
drop trigger if exists trg_unified_heat_transition on public.heat_realtime_config;
create trigger trg_unified_heat_transition
  after update
  on public.heat_realtime_config
  for each row
  execute function public.fn_unified_heat_transition();

-- 4. Mark this runtime schema as active
insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260525013000_remove_legacy_auto_advance_triggers', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
