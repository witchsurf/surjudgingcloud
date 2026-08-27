\set ON_ERROR_STOP on

begin;

do $$
declare
  v_event_id bigint;
  v_prefix text := 'panel_align_' || replace(gen_random_uuid()::text, '-', '');
  v_heat_id text;
  v_result jsonb;
  v_expected_judges text[] := array['J1','J2','J3','J4','J5'];
begin
  insert into public.events (name, organizer, start_date, end_date, price, status, paid)
  values (v_prefix, 'Panel alignment regression', current_date, current_date, 0, 'paid', true)
  returning id into v_event_id;

  v_heat_id := v_prefix || '_r1_h1';
  insert into public.heats (
    id, event_id, competition, division, round, heat_number, status, is_active, heat_size, color_order
  ) values (
    v_heat_id, v_event_id, v_prefix, 'CADET', 1, 1, 'open', false, 2, array['RED','WHITE']
  );
  insert into public.heat_configs (heat_id, judges, judge_names, surfers, waves, tournament_type)
  values (v_heat_id, array['J1','J2','J3'], '{"J1":"Old 1","J2":"Old 2","J3":"Old 3"}'::jsonb,
    array['ROUGE','BLANC'], 15, 'man_on_man');

  insert into public.podium_judge_assignments (
    event_id, podium_id, station, judge_id, judge_name, assigned_by
  )
  select v_event_id, 'A', 'J' || station, 'judge-' || station, 'Official ' || station, 'regression'
  from generate_series(1, 5) station;

  v_result := public.activate_heat_on_podium(v_event_id, 'A', v_heat_id, 'regression');

  if (v_result->>'panel_size')::integer <> 5 then
    raise exception 'activation returned unexpected panel size: %', v_result;
  end if;
  if (select judges from public.heat_configs where heat_id = v_heat_id) <> v_expected_judges then
    raise exception 'heat config judges were not aligned';
  end if;
  if (select judge_names->>'J5' from public.heat_configs where heat_id = v_heat_id) <> 'Official 5' then
    raise exception 'heat config judge names were not aligned';
  end if;
  if (select count(*) from public.heat_judge_assignments where heat_id = v_heat_id) <> 5 then
    raise exception 'official assignments were not copied';
  end if;

  raise notice 'Podium panel and heat config alignment PASS for temporary event %', v_event_id;
end;
$$;

rollback;
