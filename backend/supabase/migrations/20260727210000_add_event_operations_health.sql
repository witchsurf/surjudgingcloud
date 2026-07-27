begin;

create or replace function public.fn_get_event_operations_health(p_event_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_exists boolean;
  v_last_score_at timestamptz;
  v_last_audit_at timestamptz;
  v_podiums jsonb;
begin
  select exists(select 1 from public.events where id = p_event_id)
    into v_event_exists;

  if not v_event_exists then
    raise exception 'Event % not found', p_event_id using errcode = '23503';
  end if;

  select max(coalesce(score.timestamp, score.created_at))
    into v_last_score_at
  from public.scores score
  where score.event_id = p_event_id;

  select max(audit.created_at)
    into v_last_audit_at
  from public.competition_audit_log audit
  where audit.event_id = p_event_id;

  with podium_ids as (
    select unnest(array['A', 'B']) as podium_id
  )
  select jsonb_agg(
    jsonb_build_object(
      'podium_id', ids.podium_id,
      'active_heat_id', pointer.active_heat_id,
      'pointer_updated_at', pointer.updated_at,
      'heat_status', heat.status,
      'division', heat.division,
      'round', heat.round,
      'heat_number', heat.heat_number,
      'realtime_status', realtime.status,
      'realtime_updated_at', realtime.updated_at,
      'panel_count', (
        select count(*)
        from public.podium_judge_assignments panel
        where panel.event_id = p_event_id
          and panel.podium_id = ids.podium_id
      ),
      'heat_assignment_count', (
        select count(*)
        from public.heat_judge_assignments assignment
        where assignment.heat_id = pointer.active_heat_id
      )
    )
    order by ids.podium_id
  )
    into v_podiums
  from podium_ids ids
  left join public.active_heat_pointer pointer
    on pointer.event_id = p_event_id
   and upper(trim(coalesce(pointer.podium_id, 'A'))) = ids.podium_id
  left join public.heats heat
    on heat.id = pointer.active_heat_id
  left join public.heat_realtime_config realtime
    on realtime.heat_id = pointer.active_heat_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'checked_at', now(),
    'database_ok', true,
    'last_score_at', v_last_score_at,
    'last_score_age_seconds', case
      when v_last_score_at is null then null
      else greatest(extract(epoch from (now() - v_last_score_at))::bigint, 0)
    end,
    'last_audit_at', v_last_audit_at,
    'podiums', coalesce(v_podiums, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.fn_get_event_operations_health(bigint)
  to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727210000_add_event_operations_health', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
