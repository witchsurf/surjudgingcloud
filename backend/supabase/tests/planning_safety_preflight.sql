\set ON_ERROR_STOP on

begin;

do $$
declare
  v_event_id bigint;
  v_prefix text := 'p256i_' || replace(gen_random_uuid()::text, '-', '');
  v_heat text;
  v_rows bigint;
  v_reasons text[];
  v_status text;
begin
  insert into public.events (name, organizer, start_date, end_date, price, status, paid)
  values (v_prefix, 'P2.5.6i isolated test', current_date, current_date, 0, 'paid', true)
  returning id into v_event_id;

  -- Status compatibility matrix.
  foreach v_status in array array['waiting', 'open', 'running', 'paused', 'finished', 'closed'] loop
    insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
    values (v_prefix || '_status_' || v_status, v_event_id, v_prefix, 'STATUS', 1, 1, v_status, false);
  end loop;
  begin
    insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
    values (v_prefix || '_invalid', v_event_id, v_prefix, 'STATUS', 1, 99, 'invalid', false);
    raise exception 'invalid heat status was accepted';
  exception when check_violation then null;
  end;

  -- Activation of waiting -> open must no longer violate the heats CHECK.
  v_heat := v_prefix || '_activation';
  insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
  values (v_heat, v_event_id, v_prefix, 'ACTIVATION', 1, 1, 'waiting', false);
  insert into public.podium_judge_assignments (event_id, podium_id, station, judge_id, judge_name)
  values (v_event_id, 'A', 'J1', 'judge-1', 'Judge 1');
  perform public.activate_heat_on_podium(v_event_id, 'A', v_heat, 'p256i-test');
  select status into v_status from public.heats where id = v_heat;
  if v_status <> 'open' then raise exception 'activation expected open, got %', v_status; end if;

  -- Real legacy bulk accepts open after the compatibility migration.
  v_heat := v_prefix || '_bulk_open';
  perform public.bulk_upsert_heats(
    jsonb_build_array(jsonb_build_object(
      'id', v_heat, 'event_id', v_event_id, 'competition', v_prefix,
      'division', 'OPEN', 'round', 1, 'heat_number', 1, 'heat_size', 2,
      'status', 'open', 'color_order', array['RED', 'WHITE']
    )), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::text[]
  );
  update public.heats set is_active = false where id = v_heat;
  select count(*) into v_rows
  from public.check_heat_planning_safety(v_event_id, 'OPEN', array[v_heat], false)
  where cardinality(blocker_reasons) > 0;
  if v_rows <> 0 then raise exception 'clean open bulk heat should be SAFE'; end if;

  -- A later score between read preflight and write must be detected atomically.
  update public.heat_realtime_config set status = 'open' where heat_id = v_heat;
  insert into public.scores (
    id, heat_id, competition, division, round, judge_id, judge_name,
    surfer, wave_number, score, timestamp, event_id, judge_station
  ) values (
    v_prefix || '_score', v_heat, v_prefix, 'OPEN', 1, 'J1', 'Judge 1',
    'ROUGE', 1, 6.0, now(), v_event_id, 'J1'
  );
  select blocker_reasons into v_reasons
  from public.check_heat_planning_safety(v_event_id, 'OPEN', array[v_heat], false)
  where heat_id = v_heat;
  if not ('scores' = any(v_reasons)) then raise exception 'score blocker missing'; end if;

  begin
    perform public.bulk_upsert_heats_safe(
      v_event_id, 'OPEN', false,
      jsonb_build_array(jsonb_build_object(
        'id', v_heat, 'event_id', v_event_id, 'competition', v_prefix,
        'division', 'OPEN', 'round', 1, 'heat_number', 1, 'heat_size', 2,
        'status', 'open', 'color_order', array['RED', 'WHITE'], 'is_active', false
      )), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'safe planning accepted a score blocker';
  exception when raise_exception then
    if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if;
  end;
  if not exists (select 1 from public.heats where id = v_heat) then raise exception 'blocked heat was deleted'; end if;
  if not exists (select 1 from public.scores where id = v_prefix || '_score') then raise exception 'blocked score was deleted'; end if;

  -- Complete blocker inventory, including orphan-prone score_overrides.
  v_heat := v_prefix || '_all_blockers';
  insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
  values (v_heat, v_event_id, v_prefix, 'BLOCKERS', 1, 1, 'waiting', true);
  insert into public.heat_realtime_config (heat_id, status) values (v_heat, 'open') on conflict (heat_id) do update set status = excluded.status;
  insert into public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id, judge_station)
  values (v_prefix || '_block_score', v_heat, v_prefix, 'BLOCKERS', 1, 'J1', 'Judge', 'ROUGE', 1, 7, now(), v_event_id, 'J1');
  insert into public.score_overrides (heat_id, score_id, judge_id, judge_name, surfer, wave_number, previous_score, new_score, reason)
  values (v_heat, v_prefix || '_block_score', 'J1', 'Judge', 'ROUGE', 1, 6, 7, 'correction');
  insert into public.interference_calls (event_id, heat_id, judge_id, judge_name, surfer, wave_number, call_type)
  values (v_event_id, v_heat, 'J1', 'Judge', 'ROUGE', 1, 'INT1');
  insert into public.heat_judge_assignments (heat_id, event_id, station, judge_id, judge_name)
  values (v_heat, v_event_id, 'J1', 'J1', 'Judge');
  insert into public.heat_timers (heat_id) values (v_heat);
  insert into public.heat_history (heat_id, start_time) values (v_heat, now());
  perform public.upsert_active_heat_pointer(v_event_id, v_prefix, v_heat, now(), 'B');

  select blocker_reasons into v_reasons
  from public.check_heat_planning_safety(v_event_id, 'BLOCKERS', array[v_heat], false)
  where heat_id = v_heat;
  if not (v_reasons @> array['scores','score_overrides','interferences','judge_assignments','timers','history','is_active','active_pointer']) then
    raise exception 'incomplete blocker inventory: %', v_reasons;
  end if;

  -- Exact overwrite semantics.
  select count(*) into v_rows from public.check_heat_planning_safety(v_event_id, 'BLOCKERS', array[v_prefix || '_new'], false);
  if v_rows <> 0 then raise exception 'overwrite=false targeted a non-collision'; end if;
  select count(*) into v_rows from public.check_heat_planning_safety(v_event_id, 'BLOCKERS', array[v_heat], false);
  if v_rows <> 1 then raise exception 'overwrite=false did not target exact collision'; end if;
  select count(*) into v_rows from public.check_heat_planning_safety(v_event_id, 'STATUS', '{}'::text[], true);
  if v_rows <> 6 then raise exception 'overwrite=true did not target full category: %', v_rows; end if;
  select count(*) into v_rows from public.check_heat_planning_safety(v_event_id, 'EMPTY', '{}'::text[], true);
  if v_rows <> 0 then raise exception 'empty category should be SAFE'; end if;

  raise notice 'P2.5.6i SQL integration passed for temporary event %', v_event_id;
end;
$$;

rollback;
