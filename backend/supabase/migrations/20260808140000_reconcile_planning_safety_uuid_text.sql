begin;

-- Canonical cross-schema definition. Cloud historically stores scores.id as
-- uuid while the Mac/Event Box schema stores it as text. score_overrides.score_id
-- is text on both targets and may contain legacy non-UUID values.
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
             where override_score.id::text = score_override.score_id
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

revoke all on function public.get_heat_planning_safety_inventory(bigint, text, text[], boolean) from public;

comment on function public.get_heat_planning_safety_inventory(bigint, text, text[], boolean) is
  'Canonical cross-schema planning safety inventory; score override links compare through their stable text representation.';

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (true, '20260808140000_reconcile_planning_safety_uuid_text', null, now())
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

commit;
