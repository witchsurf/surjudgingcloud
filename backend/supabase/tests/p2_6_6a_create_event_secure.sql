begin;

update public.app_deployment_config
   set deployment_mode = 'cloud', provisioned_at = now()
 where id = true;

insert into public.events (
  name, organizer, start_date, end_date, price, currency, status, paid, categories, judges
) values (
  'P2.6.6A CLOUD HIDDEN', 'Test', current_date, current_date, 0, 'XOF', 'pending', false, '[]', '[]'
);

do $$
begin
  if has_table_privilege('anon', 'public.events', 'INSERT')
     or has_table_privilege('authenticated', 'public.events', 'INSERT')
     or has_table_privilege('anon', 'public.events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.events', 'UPDATE') then
    raise exception 'direct events writes must remain unavailable';
  end if;
  if not has_table_privilege('anon', 'public.events', 'SELECT')
     or not has_table_privilege('authenticated', 'public.events', 'SELECT') then
    raise exception 'event read privilege required by Field screens is missing';
  end if;
  if has_table_privilege('anon', 'public.app_deployment_config', 'SELECT')
     or has_table_privilege('anon', 'public.app_deployment_config', 'UPDATE')
     or has_table_privilege('authenticated', 'public.app_deployment_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_deployment_config', 'UPDATE') then
    raise exception 'deployment config must not expose direct client privileges';
  end if;
  if exists (
    select 1
      from pg_proc p,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = 'public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb)'::regprocedure
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC must not execute create_event_secure';
  end if;
  if not has_function_privilege('anon', 'public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'anon/authenticated RPC grants missing';
  end if;
end $$;

-- Cloud anonymous request must fail even though anon can execute the function.
set local role anon;
select set_config('request.headers', '{"host":"project.supabase.co"}', true);
select set_config('request.jwt.claims', '{}', true);
do $$
declare
  v_visible_count integer;
begin
  select count(*) into v_visible_count
    from public.events
   where name = 'P2.6.6A CLOUD HIDDEN';
  if v_visible_count <> 0 then
    raise exception 'local Field read policy leaked an unpaid event to Cloud anon';
  end if;
  perform * from public.create_event_secure(
    'P2.6.6A CLOUD ANON', 'Test', current_date, current_date, 0, 'XOF', '[]', '[]'
  );
  raise exception 'cloud anon unexpectedly created an event';
exception
  when insufficient_privilege then
    if sqlerrm not in ('CLOUD_AUTH_REQUIRED', 'CLOUD_ANONYMOUS_FORBIDDEN') then raise; end if;
end $$;
reset role;

-- Simulate the Cloud owner_id column while keeping the test transaction reversible.
alter table public.events add column if not exists owner_id uuid;

insert into auth.users (id, aud, role, email, created_at, updated_at, is_anonymous)
values (
  '11111111-1111-4111-8111-111111111111'::uuid,
  'authenticated',
  'authenticated',
  'p2.6.6a-cloud-auth@example.invalid',
  now(),
  now(),
  false
);

set local role authenticated;
select set_config('request.headers', '{"host":"project.supabase.co"}', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);

do $$
declare
  v_event record;
  v_owner uuid;
begin
  select * into v_event from public.create_event_secure(
    'P2.6.6A CLOUD AUTH', 'Test', current_date, current_date, 123, 'xof', '["OPEN"]', '[]'
  );
  select owner_id into v_owner from public.events where id = v_event.id;
  if pg_typeof(v_event.id)::text <> 'bigint' then raise exception 'id is not bigint'; end if;
  if v_event.user_id <> '11111111-1111-4111-8111-111111111111'::uuid or v_owner <> v_event.user_id then
    raise exception 'cloud ownership mismatch';
  end if;
  if v_event.paid or v_event.status <> 'pending' or v_event.method is not null
     or v_event.paid_at is not null or v_event.payment_ref is not null then
    raise exception 'cloud payment state was not forced safe';
  end if;
end $$;
reset role;

-- An authenticated anonymous Cloud user is still forbidden.
set local role authenticated;
select set_config('request.headers', '{"host":"project.supabase.co"}', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}',
  true
);
do $$
begin
  perform * from public.create_event_secure(
    'P2.6.6A CLOUD AUTH ANON', 'Test', current_date, current_date, 0, 'XOF', '[]', '[]'
  );
  raise exception 'cloud anonymous authenticated user unexpectedly created an event';
exception
  when insufficient_privilege then
    if sqlerrm <> 'CLOUD_ANONYMOUS_FORBIDDEN' then raise; end if;
end $$;
reset role;

-- Field trusts the local installation and accepts the anon-key role without
-- inventing a Cloud identity.
update public.app_deployment_config
   set deployment_mode = 'field', provisioned_at = now()
 where id = true;
set local role anon;
select set_config('request.headers', '{"host":"kong:8000"}', true);
select set_config('request.jwt.claims', '{}', true);
do $$
declare
  v_event record;
  v_visible_count integer;
begin
  select * into v_event from public.create_event_secure(
    'P2.6.6A FIELD', 'Test', current_date, current_date, 0, 'xof', '["OPEN"]', '[]'
  );
  if pg_typeof(v_event.id)::text <> 'bigint' or v_event.user_id is not null then
    raise exception 'field identity contract mismatch';
  end if;
  if v_event.paid or v_event.status <> 'pending' or v_event.currency <> 'XOF' then
    raise exception 'field initial state mismatch';
  end if;
  select count(*) into v_visible_count from public.events where id = v_event.id;
  if v_visible_count <> 1 then
    raise exception 'field-created event must remain visible through local RLS';
  end if;
end $$;
reset role;

-- The signature cannot accept client-owned identity, paid state or id.
do $$
declare
  v_arg_names text[];
begin
  select proargnames[1:pronargs] into v_arg_names
    from pg_proc
   where oid = 'public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb)'::regprocedure;
  if v_arg_names && array['id','p_id','owner_id','p_owner_id','user_id','p_user_id','paid','p_paid'] then
    raise exception 'forbidden client-controlled argument exposed';
  end if;
end $$;

rollback;
