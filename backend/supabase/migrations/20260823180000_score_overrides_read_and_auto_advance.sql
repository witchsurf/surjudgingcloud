-- Migration: 20260823180000_score_overrides_read_and_auto_advance.sql
-- Description: Implement minimal security definer RPC for score overrides read and backend authoritative sporting auto-advance

-- 1. Security Definer RPC for reading score overrides per heat
create or replace function public.get_heat_score_overrides(
  p_heat_id text
)
returns table (
  id uuid,
  score_id text,
  heat_id text,
  surfer text,
  wave_number integer,
  previous_score numeric,
  new_score numeric,
  judge_id text,
  judge_name text,
  judge_station text,
  reason text,
  overridden_by text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalized_heat_id text := trim(p_heat_id);
begin
  return query
  select
    so.id,
    so.score_id,
    so.heat_id,
    so.surfer,
    so.wave_number,
    so.previous_score,
    so.new_score,
    so.judge_id,
    so.judge_name,
    so.judge_station,
    so.reason,
    so.overridden_by,
    so.created_at
  from public.score_overrides so
  where so.heat_id = v_normalized_heat_id
  order by so.created_at desc;
end;
$$;

grant execute on function public.get_heat_score_overrides(text) to anon, authenticated, service_role;

-- 2. Function to compute next eligible sporting heat in the same category & podium
create or replace function public.fn_get_next_eligible_heat(
  p_event_id bigint,
  p_podium_id text,
  p_current_heat_id text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current record;
  v_next_in_round record;
  v_next_round_first record;
  v_unresolved_deps integer := 0;
begin
  select id, event_id, division, round, heat_number, status
    into v_current
  from public.heats
  where id = trim(p_current_heat_id)
    and event_id = p_event_id;

  if not found then
    return null;
  end if;

  -- Priority 1: Next heat in the current round (same division)
  select id, round, heat_number, status
    into v_next_in_round
  from public.heats
  where event_id = p_event_id
    and division = v_current.division
    and round = v_current.round
    and heat_number > v_current.heat_number
    and coalesce(status, '') != 'closed'
  order by heat_number asc
  limit 1;

  if v_next_in_round.id is not null then
    return v_next_in_round.id;
  end if;

  -- Priority 2: If no more heats in current round, first heat of next round
  -- ONLY if all qualification slots / dependencies for that heat are ready
  select id, round, heat_number, status
    into v_next_round_first
  from public.heats
  where event_id = p_event_id
    and division = v_current.division
    and round = v_current.round + 1
    and coalesce(status, '') != 'closed'
  order by heat_number asc
  limit 1;

  if v_next_round_first.id is not null then
    -- Check if all source heats feeding into this next round heat are closed
    select count(*)
      into v_unresolved_deps
    from public.heat_slot_mappings sm
    join public.heats sh on sh.event_id = p_event_id 
                        and sh.division = v_current.division
                        and sh.round = sm.source_round
                        and sh.heat_number = sm.source_heat
    where sm.heat_id = v_next_round_first.id
      and coalesce(sh.status, '') != 'closed';

    if v_unresolved_deps = 0 then
      return v_next_round_first.id;
    end if;
  end if;

  -- End of category or next round not ready: return null (never cross categories)
  return null;
end;
$$;

grant execute on function public.fn_get_next_eligible_heat(bigint, text, text) to anon, authenticated, service_role;

-- 3. Update close_heat_on_podium to determine next heat authoritatively
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
  v_readiness jsonb;
  v_force boolean := coalesce(current_setting('app.force_heat_close', true), 'false') = 'true';
  v_target_next_heat_id text := nullif(trim(coalesce(p_next_heat_id, '')), '');
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

  v_readiness := public.fn_get_heat_close_readiness(v_heat.id);
  if not coalesce((v_readiness->>'can_close')::boolean, false) and not v_force then
    raise exception 'HEAT_CLOSE_BLOCKED:%', v_readiness::text using errcode = '23514';
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now()),
         is_active = false,
         updated_at = now()
   where id = v_heat.id;

  insert into public.heat_realtime_config (
    heat_id, status, timer_start_time, updated_at, updated_by
  )
  values (
    v_heat.id, 'closed', null, now(), coalesce(nullif(trim(p_closed_by), ''), 'admin')
  )
  on conflict (heat_id)
  do update set
    status = 'closed',
    timer_start_time = null,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  -- Propagate qualifiers and rebuild division
  v_qualifier_slots := public.fn_propagate_qualifiers_for_source_heat(v_heat.id);
  v_rebuilt_slots := public.rebuild_division_qualifiers_from_scores(p_event_id, v_heat.division);

  -- Determine next heat authoritatively if not explicitly provided
  if v_target_next_heat_id is null then
    v_target_next_heat_id := public.fn_get_next_eligible_heat(p_event_id, v_podium_id, v_heat.id);
  end if;

  -- Activate next heat if available
  if v_target_next_heat_id is not null then
    v_next := public.activate_heat_on_podium(
      p_event_id, v_podium_id, v_target_next_heat_id, p_closed_by
    );

    -- Ensure the next heat is in waiting status with no running timer
    insert into public.heat_realtime_config (
      heat_id, status, timer_start_time, updated_at, updated_by
    )
    values (
      v_target_next_heat_id, 'waiting', null, now(), coalesce(nullif(trim(p_closed_by), ''), 'admin')
    )
    on conflict (heat_id)
    do update set
      status = 'waiting',
      timer_start_time = null,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  end if;

  return jsonb_build_object(
    'event_id', p_event_id,
    'podium_id', v_podium_id,
    'closed_heat_id', v_heat.id,
    'forced', v_force,
    'readiness', v_readiness,
    'qualifier_slots_updated', v_qualifier_slots,
    'division_slots_rebuilt', v_rebuilt_slots,
    'next', v_next
  );
end;
$$;

grant execute on function public.close_heat_on_podium(
  bigint, text, text, text, text
) to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
    values (true, '20260823180000_score_overrides_read_and_auto_advance', 'Score overrides secure read and backend authoritative sporting auto-advance', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          schema_label = excluded.schema_label,
          updated_at = excluded.updated_at;
  end if;
end;
$$;
