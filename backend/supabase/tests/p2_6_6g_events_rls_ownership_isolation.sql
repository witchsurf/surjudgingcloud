begin;

do $$
declare
  v_unsafe_policies text;
begin
  select string_agg(policyname, ', ' order by policyname)
    into v_unsafe_policies
    from pg_policies
     where schemaname = 'public' and tablename = 'events'
       and cmd = 'SELECT'
       and (coalesce(qual, '') = 'true' or coalesce(qual, '') ~* 'paid');
  if v_unsafe_policies is not null then
    raise exception 'permissive/public payment event reader remains active: %', v_unsafe_policies;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'events'
       and policyname = 'events_read_cloud_owner'
       and cmd = 'SELECT'
  ) then
    raise exception 'canonical Cloud owner policy missing';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'events'
       and policyname = 'events_read_authoritative_field'
  ) then
    raise exception 'authoritative Field reader was not preserved';
  end if;
end;
$$;

update public.app_deployment_config set deployment_mode = 'cloud' where id = true;

-- Satisfy the historical events.user_id foreign key inside this transaction.
-- These synthetic identities are rolled back with the fixtures below.
insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) then
    execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency, status, paid,
        categories, judges, user_id, owner_id
      ) values
        ('P2.6.6G USER OWNER', 'RLS', current_date, current_date, 0, 'XOF', 'pending', false, '[]', '[]',
         '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
        ('P2.6.6G OWNER ONLY', 'RLS', current_date, current_date, 0, 'XOF', 'pending', false, '[]', '[]',
         null, '11111111-1111-4111-8111-111111111111'),
        ('P2.6.6G FOREIGN PRIVATE', 'RLS', current_date, current_date, 0, 'XOF', 'pending', false, '[]', '[]',
         '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
        ('P2.6.6G FOREIGN PAID', 'RLS', current_date, current_date, 0, 'XOF', 'paid', true, '[]', '[]',
         '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222')
    $sql$;
  else
    insert into public.events (
      name, organizer, start_date, end_date, price, currency, status, paid,
      categories, judges, user_id
    ) values
      ('P2.6.6G USER OWNER', 'RLS', current_date, current_date, 0, 'XOF', 'pending', false, '[]', '[]',
       '11111111-1111-4111-8111-111111111111'),
      ('P2.6.6G FOREIGN PRIVATE', 'RLS', current_date, current_date, 0, 'XOF', 'pending', false, '[]', '[]',
       '22222222-2222-4222-8222-222222222222'),
      ('P2.6.6G FOREIGN PAID', 'RLS', current_date, current_date, 0, 'XOF', 'paid', true, '[]', '[]',
       '22222222-2222-4222-8222-222222222222');
  end if;
end;
$$;

set local role anon;
do $$
begin
  if (select count(*) from public.events where name like 'P2.6.6G %') <> 0 then
    raise exception 'Cloud anon can read private events';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
declare
  v_expected integer;
begin
  select case when exists (
    select 1 from pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) then 2 else 1 end into v_expected;
  if (select count(*) from public.events where name like 'P2.6.6G %') <> v_expected then
    raise exception 'Cloud owner did not receive exactly user_id + owner_id-only rows';
  end if;
  if exists (select 1 from public.events where name in ('P2.6.6G FOREIGN PRIVATE', 'P2.6.6G FOREIGN PAID')) then
    raise exception 'Cloud owner can read foreign private/paid rows';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
declare
  v_expected integer;
begin
  select case when exists (
    select 1 from pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) then 2 else 2 end into v_expected;
  if (select count(*) from public.events where name like 'P2.6.6G %') <> v_expected then
    raise exception 'foreign authenticated identity isolation mismatch';
  end if;
  if exists (select 1 from public.events where name in ('P2.6.6G USER OWNER', 'P2.6.6G OWNER ONLY')) then
    raise exception 'foreign authenticated identity can read operator rows';
  end if;
end;
$$;
reset role;

update public.app_deployment_config set deployment_mode = 'field' where id = true;
set local role anon;
do $$
declare
  v_expected integer;
begin
  select case when exists (
    select 1 from pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) then 4 else 3 end into v_expected;
  if (select count(*) from public.events where name like 'P2.6.6G %') <> v_expected then
    raise exception 'Field authoritative local visibility regressed';
  end if;
end;
$$;
reset role;

rollback;
