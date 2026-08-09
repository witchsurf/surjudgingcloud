begin;

update public.app_deployment_config
   set deployment_mode = 'cloud', cloud_test_activation_enabled = true
 where id = true;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_event_id bigint;
  v_row record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'p266c-owner@example.invalid', '', now(), now()),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'p266c-other@example.invalid', '', now(), now());

  insert into public.events (name, organizer, start_date, end_date, price, user_id, paid, status)
  values ('P2.6.6C activation', 'P2.6.6C', current_date, current_date, 50000, v_owner, false, 'pending')
  returning id into v_event_id;

  insert into public.app_cloud_test_activators (user_id, authorized_by)
  values (v_owner, 'p2.6.6c test');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  begin
    perform * from public.activate_event_for_test(v_event_id);
    raise exception 'non-owner activation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  if not public.get_event_test_activation_capability(v_event_id) then
    raise exception 'owner capability was not exposed (mode=%, uid=%, enabled=%, allowlisted=%, owned=%)',
      public.get_authoritative_deployment_mode(), auth.uid(),
      (select cloud_test_activation_enabled from public.app_deployment_config where id),
      exists (select 1 from public.app_cloud_test_activators where user_id = v_owner),
      exists (select 1 from public.events where id = v_event_id and user_id = v_owner);
  end if;
  select * into v_row from public.activate_event_for_test(v_event_id);
  if v_row.event_id <> v_event_id or v_row.test_activated_by <> v_owner or v_row.test_activated_at is null then
    raise exception 'activation audit was not persisted';
  end if;
  if exists (select 1 from public.events where id = v_event_id and (paid or status <> 'pending' or method is not null)) then
    raise exception 'test activation falsified payment state';
  end if;

  update public.app_deployment_config set deployment_mode = 'field' where id = true;
  begin
    perform * from public.activate_event_for_test(v_event_id);
    raise exception 'Field activation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  delete from public.events where id = v_event_id;
  delete from public.app_cloud_test_activators where user_id = v_owner;
  delete from auth.users where id in (v_owner, v_other);
end;
$$;

rollback;
