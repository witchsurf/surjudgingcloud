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
  v_old_status text;
begin
  if tg_op = 'UPDATE' and new.status in ('finished', 'closed') then
    v_old_status := coalesce(old.status, '');

    if v_old_status = new.status then
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

    select h.id
      into v_next_heat_id
      from public.heats h
     where h.event_id = v_event_id
       and h.division = v_division
       and h.status in ('waiting', 'open')
       and (
         (h.round = v_round and h.heat_number > v_heat_no)
         or (h.round > v_round)
       )
     order by h.round asc, h.heat_number asc
     limit 1
       for update skip locked;

    if v_next_heat_id is not null then
      update public.heat_realtime_config
         set status = 'waiting',
             timer_start_time = null,
             updated_at = now(),
             updated_by = coalesce(new.updated_by, 'system')
       where heat_id = v_next_heat_id
         and status in ('waiting', 'open');

      update public.heats
         set status = 'open'
       where id = v_next_heat_id
         and status in ('waiting', 'open');

      insert into public.active_heat_pointer (event_id, event_name, active_heat_id, updated_at)
      values (v_event_id, v_event_name, v_next_heat_id, now())
      on conflict (event_id)
      do update set
        event_name = excluded.event_name,
        active_heat_id = excluded.active_heat_id,
        updated_at = excluded.updated_at;

      raise notice 'Heat transition: % → %', new.heat_id, v_next_heat_id;
    else
      raise notice 'No more heats for event % division %', v_event_name, v_division;
    end if;
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

create or replace function public.fn_advance_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id bigint;
  v_event_name text;
  v_division text;
  v_round integer;
  v_heat_no integer;
  v_next_id text;
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

      insert into public.active_heat_pointer(event_id, event_name, active_heat_id, updated_at)
      values (v_event_id, v_event_name, v_next_id, now())
      on conflict (event_id)
      do update set
        event_name = excluded.event_name,
        active_heat_id = excluded.active_heat_id,
        updated_at = excluded.updated_at;
    end if;
  end if;

  return new;
end;
$$;
