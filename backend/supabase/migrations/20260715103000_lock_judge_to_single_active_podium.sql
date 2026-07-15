begin;

create or replace function public.is_official_judge_assignment_id(p_judge_id text)
returns boolean
language sql
immutable
as $$
  select trim(coalesce(p_judge_id, '')) <> ''
     and trim(coalesce(p_judge_id, '')) !~* '^J[0-9]+$';
$$;

create index if not exists idx_heat_judge_assignments_heat_judge_identity
  on public.heat_judge_assignments (heat_id, lower(trim(judge_id)))
  where judge_id is not null
    and trim(judge_id) <> ''
    and trim(judge_id) !~* '^J[0-9]+$';

create or replace function public.assert_no_active_podium_judge_conflict(
  p_event_id bigint,
  p_active_heat_id text,
  p_podium_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conflict record;
begin
  if p_event_id is null or nullif(trim(coalesce(p_active_heat_id, '')), '') is null then
    return;
  end if;

  select
    current_assignment.judge_id,
    current_assignment.judge_name,
    current_assignment.station as current_station,
    other_assignment.station as other_station,
    other_pointer.podium_id as other_podium_id,
    other_pointer.active_heat_id as other_heat_id
  into v_conflict
  from public.heat_judge_assignments current_assignment
  join public.active_heat_pointer other_pointer
    on other_pointer.event_id = p_event_id
   and other_pointer.active_heat_id is not null
   and other_pointer.active_heat_id <> p_active_heat_id
   and upper(trim(coalesce(other_pointer.podium_id, 'A'))) <> upper(trim(coalesce(p_podium_id, 'A')))
  join public.heat_judge_assignments other_assignment
    on other_assignment.heat_id = other_pointer.active_heat_id
   and lower(trim(other_assignment.judge_id)) = lower(trim(current_assignment.judge_id))
  where current_assignment.heat_id = p_active_heat_id
    and public.is_official_judge_assignment_id(current_assignment.judge_id)
    and public.is_official_judge_assignment_id(other_assignment.judge_id)
  limit 1;

  if found then
    raise exception
      'Judge % is already assigned to active podium % heat %',
      coalesce(v_conflict.judge_name, v_conflict.judge_id),
      coalesce(v_conflict.other_podium_id, 'A'),
      v_conflict.other_heat_id
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_active_pointer_judge_podium_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_no_active_podium_judge_conflict(
    new.event_id,
    new.active_heat_id,
    new.podium_id
  );
  return new;
end;
$$;

drop trigger if exists enforce_active_pointer_judge_podium_lock on public.active_heat_pointer;
create trigger enforce_active_pointer_judge_podium_lock
before insert or update of event_id, active_heat_id, podium_id
on public.active_heat_pointer
for each row
execute function public.enforce_active_pointer_judge_podium_lock();

create or replace function public.enforce_heat_judge_assignment_podium_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pointer record;
  v_duplicate record;
begin
  if is_official_judge_assignment_id(new.judge_id) then
    select station
    into v_duplicate
    from public.heat_judge_assignments
    where heat_id = new.heat_id
      and id <> new.id
      and lower(trim(judge_id)) = lower(trim(new.judge_id))
      and is_official_judge_assignment_id(judge_id)
    limit 1;

    if found then
      raise exception
        'Judge % is already assigned to station % on this heat',
        coalesce(new.judge_name, new.judge_id),
        v_duplicate.station
        using errcode = '23514';
    end if;
  end if;

  for v_pointer in
    select event_id, active_heat_id, podium_id
    from public.active_heat_pointer
    where active_heat_id = new.heat_id
  loop
    perform public.assert_no_active_podium_judge_conflict(
      v_pointer.event_id,
      v_pointer.active_heat_id,
      v_pointer.podium_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_heat_judge_assignment_podium_lock on public.heat_judge_assignments;
create trigger enforce_heat_judge_assignment_podium_lock
after insert or update of heat_id, event_id, station, judge_id, judge_name
on public.heat_judge_assignments
for each row
execute function public.enforce_heat_judge_assignment_podium_lock();

grant execute on function public.assert_no_active_podium_judge_conflict(bigint, text, text) to anon;
grant execute on function public.assert_no_active_podium_judge_conflict(bigint, text, text) to authenticated;
grant execute on function public.assert_no_active_podium_judge_conflict(bigint, text, text) to service_role;

grant execute on function public.is_official_judge_assignment_id(text) to anon;
grant execute on function public.is_official_judge_assignment_id(text) to authenticated;
grant execute on function public.is_official_judge_assignment_id(text) to service_role;

commit;
