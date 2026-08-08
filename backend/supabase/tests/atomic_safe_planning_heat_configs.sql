\set ON_ERROR_STOP on

begin;

do $$
declare
  v_event_id bigint;
  v_prefix text := 'p256k_' || replace(gen_random_uuid()::text, '-', '');
  v_success text := v_prefix || '_success';
  v_invalid text := v_prefix || '_invalid_config';
  v_blocked text := v_prefix || '_all_blockers';
  v_status text;
  v_status_heat text;
  v_count bigint;
begin
  insert into public.events (name, organizer, start_date, end_date, price, status, paid)
  values (v_prefix, 'P2.5.6k isolated test', current_date, current_date, 0, 'paid', true)
  returning id into v_event_id;

  -- Success: bracket and config are committed together and remain inactive.
  perform public.bulk_upsert_heats_safe_v2(
    v_event_id, 'SUCCESS', false,
    jsonb_build_array(jsonb_build_object(
      'id', v_success, 'event_id', v_event_id, 'competition', v_prefix,
      'division', 'SUCCESS', 'round', 1, 'heat_number', 1, 'heat_size', 2,
      'status', 'open', 'color_order', array['RED','WHITE'], 'is_active', false
    )),
    jsonb_build_array(jsonb_build_object(
      'heat_id', v_success, 'participant_id', null, 'position', 1, 'seed', 1, 'color', 'RED'
    )),
    jsonb_build_array(jsonb_build_object(
      'heat_id', v_success, 'position', 1, 'placeholder', 'R2-H1-P1',
      'source_round', 2, 'source_heat', 1, 'source_position', 1
    )),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'heat_id', v_success, 'judges', array['J1','J2','J3'],
      'judge_names', '{}'::jsonb, 'surfers', array['ROUGE','BLANC'],
      'waves', 15, 'tournament_type', 'elimination'
    ))
  );
  if not exists (select 1 from public.heats where id = v_success and is_active = false) then raise exception 'inactive heat missing'; end if;
  if not exists (select 1 from public.heat_entries where heat_id = v_success) then raise exception 'entry missing'; end if;
  if not exists (select 1 from public.heat_slot_mappings where heat_id = v_success) then raise exception 'mapping missing'; end if;
  if not exists (select 1 from public.heat_realtime_config where heat_id = v_success) then raise exception 'realtime config missing'; end if;
  if not exists (
    select 1 from public.heat_configs
    where heat_id = v_success
      and judges = array['J1','J2','J3']::text[]
      and surfers = array['ROUGE','BLANC']::text[]
      and judge_names = '{}'::jsonb
      and waves = 15
      and tournament_type = 'elimination'
  ) then raise exception 'historical config payload was not preserved'; end if;

  -- Critical rollback: the historical bulk succeeds first, then a NOT NULL
  -- config failure must roll every write for the new heat back.
  begin
    perform public.bulk_upsert_heats_safe_v2(
      v_event_id, 'INVALID_CONFIG', false,
      jsonb_build_array(jsonb_build_object(
        'id', v_invalid, 'event_id', v_event_id, 'competition', v_prefix,
        'division', 'INVALID_CONFIG', 'round', 1, 'heat_number', 1, 'heat_size', 2,
        'status', 'open', 'color_order', array['RED','WHITE'], 'is_active', false
      )),
      jsonb_build_array(jsonb_build_object('heat_id', v_invalid, 'participant_id', null, 'position', 1, 'seed', 1, 'color', 'RED')),
      jsonb_build_array(jsonb_build_object('heat_id', v_invalid, 'position', 1, 'placeholder', null)),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'heat_id', v_invalid, 'judges', null, 'judge_names', '{}'::jsonb,
        'surfers', array['ROUGE','BLANC'], 'waves', 15, 'tournament_type', 'elimination'
      ))
    );
    raise exception 'invalid config was accepted';
  exception when not_null_violation then null;
  end;
  select
    (select count(*) from public.heats where id = v_invalid)
    + (select count(*) from public.heat_entries where heat_id = v_invalid)
    + (select count(*) from public.heat_slot_mappings where heat_id = v_invalid)
    + (select count(*) from public.heat_realtime_config where heat_id = v_invalid)
    + (select count(*) from public.heat_configs where heat_id = v_invalid)
  into v_count;
  if v_count <> 0 then raise exception 'config failure left % partial rows', v_count; end if;

  -- All data blockers remain effective through v2.
  insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
  values (v_blocked, v_event_id, v_prefix, 'BLOCKERS', 1, 1, 'open', true);
  insert into public.heat_realtime_config (heat_id, status) values (v_blocked, 'open');
  insert into public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id, judge_station)
  values (v_prefix || '_score', v_blocked, v_prefix, 'BLOCKERS', 1, 'J1', 'Judge', 'ROUGE', 1, 8, now(), v_event_id, 'J1');
  insert into public.score_overrides (heat_id, score_id, judge_id, judge_name, surfer, wave_number, previous_score, new_score, reason)
  values (v_blocked, v_prefix || '_score', 'J1', 'Judge', 'ROUGE', 1, 7, 8, 'correction');
  insert into public.interference_calls (event_id, heat_id, judge_id, judge_name, surfer, wave_number, call_type)
  values (v_event_id, v_blocked, 'J1', 'Judge', 'ROUGE', 1, 'INT1');
  insert into public.heat_judge_assignments (heat_id, event_id, station, judge_id, judge_name)
  values (v_blocked, v_event_id, 'J1', 'J1', 'Judge');
  insert into public.heat_timers (heat_id) values (v_blocked);
  insert into public.heat_history (heat_id, start_time) values (v_blocked, now());
  perform public.upsert_active_heat_pointer(v_event_id, v_prefix, v_blocked, now(), 'B');
  begin
    perform public.bulk_upsert_heats_safe_v2(
      v_event_id, 'BLOCKERS', false,
      jsonb_build_array(jsonb_build_object('id', v_blocked, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'BLOCKERS', 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('heat_id', v_blocked, 'judges', array['J1','J2','J3'], 'judge_names', '{}'::jsonb, 'surfers', array['ROUGE'], 'waves', 15, 'tournament_type', 'elimination'))
    );
    raise exception 'v2 accepted data blockers';
  exception when raise_exception then if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if; end;

  -- Every protected lifecycle status still blocks v2 independently.
  foreach v_status in array array['running','paused','finished','closed'] loop
    v_status_heat := v_prefix || '_status_' || v_status;
    insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
    values (v_status_heat, v_event_id, v_prefix, 'STATUS_' || upper(v_status), 1, 1, v_status, false);
    begin
      perform public.bulk_upsert_heats_safe_v2(
        v_event_id, 'STATUS_' || upper(v_status), false,
        jsonb_build_array(jsonb_build_object('id', v_status_heat, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'STATUS_' || upper(v_status), 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        jsonb_build_array(jsonb_build_object('heat_id', v_status_heat, 'judges', array['J1','J2','J3'], 'judge_names', '{}'::jsonb, 'surfers', array['ROUGE'], 'waves', 15, 'tournament_type', 'elimination'))
      );
      raise exception 'v2 accepted protected status %', v_status;
    exception when raise_exception then if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if; end;
  end loop;

  raise notice 'P2.5.6k atomic safe planning passed for temporary event %', v_event_id;
end;
$$;

rollback;
