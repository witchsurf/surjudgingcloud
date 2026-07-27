begin;

create or replace function public.fn_get_heat_close_readiness(p_heat_id text)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_heat record;
  v_score_count integer := 0;
  v_missing_score_count integer := 0;
  v_missing_lineup_count integer := 0;
  v_expected_judges integer := 0;
  v_assigned_judges integer := 0;
  v_invalid_score_count integer := 0;
  v_orphan_score_count integer := 0;
  v_pending_slots jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  select id, event_id, division, round, heat_number, heat_size, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id);

  if not found then
    raise exception 'Heat % not found', p_heat_id using errcode = '23503';
  end if;

  select count(*)::integer
    into v_score_count
  from public.v_scores_canonical_enriched score
  where score.heat_id = v_heat.id
    and score.score > 0;

  select count(*)::integer,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'judge_station', slot.judge_station,
             'judge_identity_id', slot.judge_identity_id,
             'judge_display_name', slot.judge_display_name,
             'surfer', slot.surfer,
             'wave_number', slot.wave_number
           )
           order by slot.judge_display_name, slot.surfer, slot.wave_number
         ), '[]'::jsonb)
    into v_missing_score_count, v_pending_slots
  from public.v_heat_missing_score_slots slot
  where slot.heat_id = v_heat.id;

  select greatest(v_heat.heat_size - count(*) filter (where entry.participant_id is not null), 0)::integer
    into v_missing_lineup_count
  from public.heat_entries entry
  where entry.heat_id = v_heat.id;

  select coalesce(jsonb_array_length(coalesce(to_jsonb(config.judges), '[]'::jsonb)), 0)
    into v_expected_judges
  from public.heat_configs config
  where config.heat_id = v_heat.id
  limit 1;
  v_expected_judges := coalesce(v_expected_judges, 0);

  select count(distinct upper(trim(assignment.station)))::integer
    into v_assigned_judges
  from public.heat_judge_assignments assignment
  where assignment.heat_id = v_heat.id;

  if v_expected_judges = 0 and v_assigned_judges > 0 then
    v_expected_judges := v_assigned_judges;
  end if;

  select count(*)::integer
    into v_invalid_score_count
  from public.scores score
  where score.heat_id = v_heat.id
    and (score.score < 0 or score.score > 10);

  select count(*)::integer
    into v_orphan_score_count
  from public.v_scores_canonical_enriched score
  where score.heat_id = v_heat.id
    and score.score > 0
    and not exists (
      select 1
      from public.heat_entries entry
      where entry.heat_id = v_heat.id
        and public.fn_normalize_jersey_label_sql(entry.color)
            = public.fn_normalize_jersey_label_sql(score.surfer)
    );

  if v_score_count = 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'NO_SCORES',
      'count', 1,
      'message', 'Aucune note enregistrée'
    ));
  end if;

  if v_missing_score_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'MISSING_SCORES',
      'count', v_missing_score_count,
      'message', format('%s note(s) manquante(s)', v_missing_score_count),
      'details', v_pending_slots
    ));
  end if;

  if v_missing_lineup_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'UNRESOLVED_LINEUP',
      'count', v_missing_lineup_count,
      'message', format('%s place(s) du lineup non résolue(s)', v_missing_lineup_count)
    ));
  end if;

  if v_expected_judges = 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'NO_JUDGE_PANEL',
      'count', 1,
      'message', 'Aucun panel de juges enregistré sur le heat'
    ));
  elsif v_assigned_judges < v_expected_judges then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INCOMPLETE_JUDGE_PANEL',
      'count', v_expected_judges - v_assigned_judges,
      'message', format('Panel incomplet: %s/%s juge(s)', v_assigned_judges, v_expected_judges)
    ));
  end if;

  if v_invalid_score_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_SCORES',
      'count', v_invalid_score_count,
      'message', format('%s note(s) hors de la plage 0–10', v_invalid_score_count)
    ));
  end if;

  if v_orphan_score_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'ORPHAN_SCORES',
      'count', v_orphan_score_count,
      'message', format('%s note(s) liée(s) à un lycra absent du lineup', v_orphan_score_count)
    ));
  end if;

  return jsonb_build_object(
    'heat_id', v_heat.id,
    'event_id', v_heat.event_id,
    'division', v_heat.division,
    'round', v_heat.round,
    'heat_number', v_heat.heat_number,
    'status', v_heat.status,
    'can_close', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'summary', jsonb_build_object(
      'score_count', v_score_count,
      'missing_score_count', v_missing_score_count,
      'missing_lineup_count', v_missing_lineup_count,
      'expected_judges', v_expected_judges,
      'assigned_judges', v_assigned_judges,
      'invalid_score_count', v_invalid_score_count,
      'orphan_score_count', v_orphan_score_count
    )
  );
end;
$$;

grant execute on function public.fn_get_heat_close_readiness(text)
  to anon, authenticated, service_role;

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

  v_qualifier_slots := public.fn_propagate_qualifiers_for_source_heat(v_heat.id);
  v_rebuilt_slots := public.rebuild_division_qualifiers_from_scores(p_event_id, v_heat.division);

  if nullif(trim(coalesce(p_next_heat_id, '')), '') is not null then
    v_next := public.activate_heat_on_podium(
      p_event_id, v_podium_id, trim(p_next_heat_id), p_closed_by
    );
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

create or replace function public.close_heat_on_podium_strict(
  p_event_id bigint,
  p_podium_id text,
  p_heat_id text,
  p_next_heat_id text default null,
  p_closed_by text default 'admin',
  p_force boolean default false,
  p_force_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
  v_result jsonb;
  v_reason text := nullif(trim(coalesce(p_force_reason, '')), '');
begin
  v_readiness := public.fn_get_heat_close_readiness(trim(p_heat_id));

  if p_force and v_reason is null then
    raise exception 'A reason is required to force heat closure' using errcode = '23514';
  end if;

  if p_force then
    perform set_config('app.force_heat_close', 'true', true);
    insert into public.competition_audit_log (
      event_id, heat_id, podium_id, action_type, entity_type, entity_id,
      actor_id, actor_name, actor_role, metadata
    ) values (
      p_event_id,
      trim(p_heat_id),
      upper(trim(coalesce(p_podium_id, 'A'))),
      'HEAT_CLOSE_FORCED',
      'heat',
      trim(p_heat_id),
      p_closed_by,
      p_closed_by,
      'chief_judge',
      jsonb_build_object('reason', v_reason, 'readiness', v_readiness)
    );
  end if;

  v_result := public.close_heat_on_podium(
    p_event_id, p_podium_id, p_heat_id, p_next_heat_id, p_closed_by
  );
  return v_result;
end;
$$;

grant execute on function public.close_heat_on_podium_strict(
  bigint, text, text, text, text, boolean, text
) to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727200000_add_strict_heat_close_readiness', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
