\set ON_ERROR_STOP on

begin;

do $$
declare
  v_event_id bigint;
  v_prefix text := 'p263e_' || replace(gen_random_uuid()::text, '-', '');
  v_runtime_heat text := v_prefix || '_runtime';
  v_planning_heat text := v_prefix || '_planning';
  v_service_heat text := v_prefix || '_service';
  v_count bigint;
begin
  insert into public.events (name, organizer, start_date, end_date, price, status, paid)
  values (v_prefix, 'P2.6.3e isolated ACL test', current_date, current_date, 0, 'paid', true)
  returning id into v_event_id;

  insert into public.heats (
    id, event_id, competition, division, round, heat_number, status, is_active
  ) values (
    v_runtime_heat, v_event_id, v_prefix, 'RUNTIME', 1, 1, 'waiting', false
  ), (
    v_service_heat, v_event_id, v_prefix, 'SERVICE', 1, 1, 'waiting', false
  );

  -- Reproduce the Cloud historical ACL before the candidate revocation.
  grant all on table public.heat_configs to authenticated, service_role;

  execute 'set local role authenticated';
  insert into public.heat_configs (heat_id, judges, surfers)
  values (v_runtime_heat, array['J1','J2','J3'], array['ROUGE','BLANC']);
  execute 'reset role';

  -- Candidate P2.6.3E revocation.
  revoke insert, update on table public.heat_configs from authenticated;

  execute 'set local role authenticated';
  select count(*) into v_count from public.heat_configs where heat_id = v_runtime_heat;
  if v_count <> 1 then raise exception 'authenticated SELECT regression'; end if;

  begin
    insert into public.heat_configs (heat_id, judges, surfers)
    values (v_prefix || '_forbidden', array['J1','J2','J3'], array['ROUGE','BLANC']);
    raise exception 'authenticated direct INSERT unexpectedly remained available';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.heat_configs set waves = 12 where heat_id = v_runtime_heat;
    raise exception 'authenticated direct UPDATE unexpectedly remained available';
  exception when insufficient_privilege then null;
  end;

  -- Modern planning remains available through the SECURITY DEFINER RPC.
  perform public.bulk_upsert_heats_safe_v2(
    v_event_id,
    'PLANNING',
    false,
    jsonb_build_array(jsonb_build_object(
      'id', v_planning_heat,
      'event_id', v_event_id,
      'competition', v_prefix,
      'division', 'PLANNING',
      'round', 1,
      'heat_number', 1,
      'heat_size', 2,
      'status', 'open',
      'color_order', array['ROUGE','BLANC'],
      'is_active', false
    )),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'heat_id', v_planning_heat,
      'judges', array['J1','J2','J3'],
      'surfers', array['ROUGE','BLANC'],
      'judge_names', '{}'::jsonb,
      'waves', 15,
      'tournament_type', 'elimination'
    ))
  );

  select count(*) into v_count from public.heat_configs where heat_id = v_planning_heat;
  if v_count <> 1 then raise exception 'safe v2 failed after direct-write revocation'; end if;
  execute 'reset role';

  -- The candidate leaves service_role untouched.
  execute 'set local role service_role';
  insert into public.heat_configs (heat_id, judges, surfers)
  values (v_service_heat, array['J1','J2','J3'], array['ROUGE','BLANC']);
  execute 'reset role';

  -- The existing runtime repository/offline path is a direct upsert. Its
  -- UPDATE branch is therefore proven incompatible with the candidate ACL.
  execute 'set local role authenticated';
  begin
    insert into public.heat_configs (heat_id, judges, surfers, waves)
    values (v_runtime_heat, array['J1','J2','J3'], array['ROUGE','BLANC'], 12)
    on conflict (heat_id) do update set waves = excluded.waves;
    raise exception 'runtime direct upsert unexpectedly remained available';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end;
$$;

rollback;

\echo 'P2.6.3E heat_configs privilege characterization: EXPECTED RUNTIME BLOCKER CONFIRMED'
