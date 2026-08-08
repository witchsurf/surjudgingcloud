\set ON_ERROR_STOP on

begin;

do $$
declare
  v_event_id bigint;
  v_prefix text := 'p256j_' || replace(gen_random_uuid()::text, '-', '');
  v_heat_a text := v_prefix || '_open_r1_h1';
  v_heat_b text := v_prefix || '_open_r1_h2';
  v_collision text := v_prefix || '_collision';
  v_score_heat text := v_prefix || '_score';
  v_judge_heat text := v_prefix || '_judge';
  v_closed_heat text := v_prefix || '_closed';
  v_before bigint;
begin
  insert into public.events (name, organizer, start_date, end_date, price, status, paid)
  values (v_prefix, 'P2.5.6j isolated test', current_date, current_date, 0, 'paid', true)
  returning id into v_event_id;

  -- A/D: equivalent initial planning, status open, explicitly inactive.
  perform public.bulk_upsert_heats_safe(
    v_event_id, 'OPEN', true,
    jsonb_build_array(
      jsonb_build_object('id', v_heat_a, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'OPEN', 'round', 1, 'heat_number', 1, 'heat_size', 2, 'status', 'open', 'color_order', array['RED','WHITE'], 'is_active', false),
      jsonb_build_object('id', v_heat_b, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'OPEN', 'round', 1, 'heat_number', 2, 'heat_size', 2, 'status', 'open', 'color_order', array['RED','WHITE'], 'is_active', false)
    ), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
  );
  if exists (select 1 from public.heats where id in (v_heat_a, v_heat_b) and coalesce(is_active, true)) then
    raise exception 'initial planning created an active heat';
  end if;

  -- A payload omitting/setting true must fail closed.
  begin
    perform public.bulk_upsert_heats_safe(
      v_event_id, 'BAD', false,
      jsonb_build_array(jsonb_build_object('id', v_prefix || '_bad', 'event_id', v_event_id, 'competition', v_prefix, 'division', 'BAD', 'round', 1, 'heat_number', 1, 'status', 'open')),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'safe RPC accepted a missing is_active';
  exception when raise_exception then
    if sqlerrm <> 'heat payload event/category/is_active mismatch' then raise; end if;
  end;

  -- B: lifecycle alone activates one heat; the other stays inactive.
  insert into public.podium_judge_assignments (event_id, podium_id, station, judge_id, judge_name)
  values (v_event_id, 'A', 'J1', 'judge-1', 'Judge 1');
  perform public.activate_heat_on_podium(v_event_id, 'A', v_heat_a, 'p256j-test');
  if not (select coalesce(is_active, false) from public.heats where id = v_heat_a) then
    raise exception 'lifecycle did not activate selected heat';
  end if;
  if (select coalesce(is_active, false) from public.heats where id = v_heat_b) then
    raise exception 'lifecycle activated another heat';
  end if;

  -- C: regeneration with an active heat is blocked and data stays intact.
  select count(*) into v_before from public.heats where event_id = v_event_id and division = 'OPEN';
  begin
    perform public.bulk_upsert_heats_safe(
      v_event_id, 'OPEN', true,
      jsonb_build_array(jsonb_build_object('id', v_heat_a, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'OPEN', 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'active category regeneration was accepted';
  exception when raise_exception then
    if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if;
  end;
  if (select count(*) from public.heats where event_id = v_event_id and division = 'OPEN') <> v_before then
    raise exception 'blocked regeneration changed heats';
  end if;

  -- E: clean open collision is replaceable and remains inactive.
  perform public.bulk_upsert_heats_safe(
    v_event_id, 'COLLISION', false,
    jsonb_build_array(jsonb_build_object('id', v_collision, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'COLLISION', 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
  );
  perform public.bulk_upsert_heats_safe(
    v_event_id, 'COLLISION', false,
    jsonb_build_array(jsonb_build_object('id', v_collision, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'COLLISION', 'round', 1, 'heat_number', 1, 'heat_size', 3, 'status', 'open', 'is_active', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
  );
  if (select heat_size from public.heats where id = v_collision) <> 3 then raise exception 'clean collision was not replaced'; end if;
  if (select coalesce(is_active, true) from public.heats where id = v_collision) then raise exception 'replacement activated collision heat'; end if;

  -- F: score collision blocks replacement and preserves score.
  perform public.bulk_upsert_heats_safe(v_event_id, 'SCORE', false,
    jsonb_build_array(jsonb_build_object('id', v_score_heat, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'SCORE', 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  update public.heat_realtime_config set status = 'open' where heat_id = v_score_heat;
  insert into public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id, judge_station)
  values (v_prefix || '_score_fact', v_score_heat, v_prefix, 'SCORE', 1, 'J1', 'Judge', 'ROUGE', 1, 8, now(), v_event_id, 'J1');
  begin
    perform public.bulk_upsert_heats_safe(v_event_id, 'SCORE', false,
      jsonb_build_array(jsonb_build_object('id', v_score_heat, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'SCORE', 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'score collision was accepted';
  exception when raise_exception then if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if; end;
  if not exists (select 1 from public.scores where id = v_prefix || '_score_fact') then raise exception 'score was deleted'; end if;

  -- G: judge assignment blocks.
  perform public.bulk_upsert_heats_safe(v_event_id, 'JUDGE', false,
    jsonb_build_array(jsonb_build_object('id', v_judge_heat, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'JUDGE', 'round', 1, 'heat_number', 1, 'status', 'waiting', 'is_active', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  insert into public.heat_judge_assignments (heat_id, event_id, station, judge_id, judge_name)
  values (v_judge_heat, v_event_id, 'J1', 'judge-2', 'Judge 2');
  begin
    perform public.bulk_upsert_heats_safe(v_event_id, 'JUDGE', false,
      jsonb_build_array(jsonb_build_object('id', v_judge_heat, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'JUDGE', 'round', 1, 'heat_number', 1, 'status', 'waiting', 'is_active', false)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'judge assignment collision was accepted';
  exception when raise_exception then if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if; end;

  -- H: closed status blocks overwrite=true.
  insert into public.heats (id, event_id, competition, division, round, heat_number, status, is_active)
  values (v_closed_heat, v_event_id, v_prefix, 'CLOSED', 1, 1, 'closed', false);
  begin
    perform public.bulk_upsert_heats_safe(v_event_id, 'CLOSED', true,
      jsonb_build_array(jsonb_build_object('id', v_closed_heat, 'event_id', v_event_id, 'competition', v_prefix, 'division', 'CLOSED', 'round', 1, 'heat_number', 1, 'status', 'open', 'is_active', false)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'closed overwrite was accepted';
  exception when raise_exception then if sqlerrm <> 'HEAT_PLANNING_BLOCKED' then raise; end if; end;
  if not exists (select 1 from public.heats where id = v_closed_heat and status = 'closed') then raise exception 'closed heat changed'; end if;

  raise notice 'P2.5.6j safe persistence readiness passed for temporary event %', v_event_id;
end;
$$;

rollback;
