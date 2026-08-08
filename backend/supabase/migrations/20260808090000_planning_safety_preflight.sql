begin;

-- Temporary compatibility bridge. Rollback (only after all `open` rows have
-- been canonicalized): recreate this constraint without `open`.
alter table public.heats drop constraint if exists heats_status_check;
alter table public.heats
  add constraint heats_status_check
  check (status in ('waiting', 'open', 'running', 'paused', 'finished', 'closed'));

create or replace function public.get_heat_planning_safety_inventory(
  p_event_id bigint,
  p_category text,
  p_proposed_heat_ids text[] default '{}'::text[],
  p_overwrite boolean default false
)
returns table (
  heat_id text,
  status text,
  is_active boolean,
  score_count bigint,
  override_count bigint,
  interference_count bigint,
  judge_assignment_count bigint,
  timer_count bigint,
  history_count bigint,
  active_pointer_count bigint,
  blocker_reasons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with targeted as (
    select h.id, h.status, coalesce(h.is_active, false) as is_active
    from public.heats h
    where h.event_id = p_event_id
      and h.division = p_category
      and (
        coalesce(p_overwrite, false)
        or h.id = any(coalesce(p_proposed_heat_ids, '{}'::text[]))
      )
  ), inventory as (
    select
      targeted.id as heat_id,
      targeted.status,
      targeted.is_active,
      (select count(*) from public.scores s where s.heat_id = targeted.id) as score_count,
      (
        select count(*)
        from public.score_overrides score_override
        where score_override.heat_id = targeted.id
           or exists (
             select 1 from public.scores override_score
             where override_score.id = score_override.score_id
               and override_score.heat_id = targeted.id
           )
      ) as override_count,
      (select count(*) from public.interference_calls interference where interference.heat_id = targeted.id) as interference_count,
      (select count(*) from public.heat_judge_assignments assignment where assignment.heat_id = targeted.id) as judge_assignment_count,
      (select count(*) from public.heat_timers timer where timer.heat_id = targeted.id) as timer_count,
      (select count(*) from public.heat_history history where history.heat_id = targeted.id) as history_count,
      (select count(*) from public.active_heat_pointer pointer where pointer.active_heat_id = targeted.id) as active_pointer_count
    from targeted
  )
  select
    inventory.*,
    array_remove(array[
      case when inventory.score_count > 0 then 'scores' end,
      case when inventory.override_count > 0 then 'score_overrides' end,
      case when inventory.interference_count > 0 then 'interferences' end,
      case when inventory.judge_assignment_count > 0 then 'judge_assignments' end,
      case when inventory.timer_count > 0 then 'timers' end,
      case when inventory.history_count > 0 then 'history' end,
      case when inventory.is_active then 'is_active' end,
      case when inventory.active_pointer_count > 0 then 'active_pointer' end,
      case when inventory.status in ('running', 'paused', 'finished', 'closed') then 'status:' || inventory.status end
    ], null)::text[] as blocker_reasons
  from inventory
  order by inventory.heat_id;
$$;

create or replace function public.check_heat_planning_safety(
  p_event_id bigint,
  p_category text,
  p_proposed_heat_ids text[] default '{}'::text[],
  p_overwrite boolean default false
)
returns table (
  heat_id text,
  status text,
  is_active boolean,
  score_count bigint,
  override_count bigint,
  interference_count bigint,
  judge_assignment_count bigint,
  timer_count bigint,
  history_count bigint,
  active_pointer_count bigint,
  blocker_reasons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.get_heat_planning_safety_inventory(
    p_event_id,
    p_category,
    p_proposed_heat_ids,
    p_overwrite
  );
$$;

create or replace function public.bulk_upsert_heats_safe(
  p_event_id bigint,
  p_category text,
  p_overwrite boolean default false,
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
  v_proposed_heat_ids text[];
  v_target_heat_ids text[];
  v_blocked jsonb;
begin
  if p_event_id is null then raise exception 'event_id is required'; end if;
  if nullif(p_category, '') is null then raise exception 'category is required'; end if;
  if jsonb_typeof(coalesce(p_heats, '[]'::jsonb)) <> 'array' then raise exception 'heats payload must be an array'; end if;

  select coalesce(array_agg(payload.id order by payload.id), '{}'::text[])
    into v_proposed_heat_ids
  from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) as payload(id text, event_id bigint, division text)
  where payload.id is not null;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) as payload(id text, event_id bigint, division text)
    where payload.id is null or payload.event_id is distinct from p_event_id or payload.division is distinct from p_category
  ) then
    raise exception 'heat payload event/category mismatch';
  end if;

  -- Serialize planning for this event/category, then prevent concurrent blocker
  -- inserts (including score_overrides, which has no FK) until commit.
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || length(p_category)::text || ':' || p_category, 0));
  perform 1
  from public.heats h
  where h.event_id = p_event_id
    and h.division = p_category
    and (coalesce(p_overwrite, false) or h.id = any(v_proposed_heat_ids))
  for update;
  lock table public.scores, public.score_overrides, public.interference_calls,
    public.heat_judge_assignments, public.heat_timers, public.heat_history,
    public.active_heat_pointer in share row exclusive mode;

  select coalesce(array_agg(inventory.heat_id order by inventory.heat_id), '{}'::text[]),
         jsonb_agg(to_jsonb(inventory) order by inventory.heat_id)
           filter (where cardinality(inventory.blocker_reasons) > 0)
    into v_target_heat_ids, v_blocked
  from public.get_heat_planning_safety_inventory(
    p_event_id,
    p_category,
    v_proposed_heat_ids,
    p_overwrite
  ) inventory;

  if v_blocked is not null then
    raise exception using
      errcode = 'P0001',
      message = 'HEAT_PLANNING_BLOCKED',
      detail = v_blocked::text;
  end if;

  perform public.bulk_upsert_heats(
    coalesce(p_heats, '[]'::jsonb),
    coalesce(p_entries, '[]'::jsonb),
    coalesce(p_mappings, '[]'::jsonb),
    coalesce(p_participants, '[]'::jsonb),
    v_target_heat_ids
  );
end;
$$;

revoke all on function public.get_heat_planning_safety_inventory(bigint, text, text[], boolean) from public;
revoke all on function public.check_heat_planning_safety(bigint, text, text[], boolean) from public;
revoke all on function public.bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb) from public;

grant execute on function public.check_heat_planning_safety(bigint, text, text[], boolean) to anon, authenticated, service_role;
grant execute on function public.bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

comment on function public.check_heat_planning_safety(bigint, text, text[], boolean) is
  'Read-only deterministic inventory of exactly the heats targeted by current planning overwrite semantics.';
comment on function public.bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb) is
  'Atomic planning wrapper: rechecks blockers under transaction locks before calling legacy bulk_upsert_heats.';

commit;
