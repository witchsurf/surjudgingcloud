\set ON_ERROR_STOP on
begin;

do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '22222222-2222-4222-8222-222222222222';
  v_allowed_event bigint;
  v_denied_event bigint;
  v_allowed_heat text := 'p263f_allowed_heat';
  v_denied_heat text := 'p263f_denied_heat';
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, encrypted_password)
  values
    (v_owner, 'authenticated', 'authenticated', 'p263f-owner@example.invalid', ''),
    (v_other, 'authenticated', 'authenticated', 'p263f-other@example.invalid', '')
  on conflict (id) do nothing;

  insert into public.events (name, organizer, start_date, end_date, price, user_id, paid)
  values ('P2.6.3F allowed', 'P2.6.3F', current_date, current_date, 0, v_owner, false)
  returning id into v_allowed_event;
  insert into public.events (name, organizer, start_date, end_date, price, user_id, paid)
  values ('P2.6.3F denied', 'P2.6.3F', current_date, current_date, 0, v_other, false)
  returning id into v_denied_event;

  insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order)
  values
    (v_allowed_heat, v_allowed_event, 'P2.6.3F', 'OPEN', 1, 1, 2, 'waiting', array['ROUGE','BLANC']),
    (v_denied_heat, v_denied_event, 'P2.6.3F', 'OPEN', 1, 2, 2, 'waiting', array['ROUGE','BLANC']);

  -- The isolated schema-only restore intentionally omits ACLs. Recreate only
  -- the read/runtime grants shared by Cloud-like and Mac-like environments.
  grant usage on schema public to authenticated, service_role;
  grant select, insert, update on public.heat_configs to authenticated;
  grant execute on function public.bulk_upsert_heats_safe_v2(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

  perform set_config('request.headers', '{"host":"project.supabase.co"}', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  set local role authenticated;

  perform public.upsert_heat_config_runtime(v_allowed_heat, array['J1','J2','J3'], array['ROUGE','BLANC'], '{"J1":"One"}', 12, 'elimination');
  perform public.upsert_heat_config_runtime(v_allowed_heat, array['J1','J2','J3'], array['ROUGE','BLANC'], '{"J1":"Updated"}', 15, 'elimination');
  update public.heat_configs set waves = 13 where heat_id = v_allowed_heat;

  begin
    perform public.upsert_heat_config_runtime(v_denied_heat, array['J1','J2','J3'], array['ROUGE'], '{}', 12, 'elimination');
    raise exception 'unauthorized heat unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.upsert_heat_config_runtime('', array[]::text[], array[]::text[], '{}', 12, 'elimination');
    raise exception 'invalid payload unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;

  set local role postgres;
  revoke insert, update on public.heat_configs from authenticated;
  set local role authenticated;
  perform public.upsert_heat_config_runtime(v_allowed_heat, array['J1','J2','J3'], array['ROUGE','BLANC'], '{}', 14, 'elimination');
  perform 1 from public.heat_configs where heat_id = v_allowed_heat;

  begin
    insert into public.heat_configs (heat_id, judges, surfers) values (v_denied_heat, '{}', '{}');
    raise exception 'direct insert unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;

  set local role postgres;
  select count(*) into v_count from public.heat_configs where heat_id = v_allowed_heat and waves = 14;
  if v_count <> 1 then raise exception 'runtime upsert was not idempotent'; end if;

  if has_function_privilege('public', 'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)', 'EXECUTE') then
    raise exception 'PUBLIC can execute runtime heat config RPC';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.upsert_heat_config_runtime(v_denied_heat, array['J1','J2','J3'], array['ROUGE'], '{}', 12, 'elimination');
  perform public.bulk_upsert_heats_safe_v2(v_allowed_event, 'UNUSED', false, '[]', '[]', '[]', '[]', '[]');
end;
$$;

rollback;
\echo 'P2.6.3F runtime heat config RPC: PASS'
