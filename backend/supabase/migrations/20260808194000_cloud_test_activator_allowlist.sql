begin;

create table if not exists public.app_cloud_test_activators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  authorized_at timestamptz not null default now(),
  authorized_by text
);

alter table public.app_cloud_test_activators enable row level security;
revoke all on table public.app_cloud_test_activators from public, anon, authenticated;

create or replace function public.get_event_test_activation_capability(p_event_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_enabled boolean := false;
begin
  if public.get_authoritative_deployment_mode() <> 'cloud' or v_user_id is null then
    return false;
  end if;
  select cloud_test_activation_enabled into v_enabled
    from public.app_deployment_config where id = true;
  if not coalesce(v_enabled, false)
     or not exists (select 1 from public.app_cloud_test_activators where user_id = v_user_id) then
    return false;
  end if;
  return exists (
    select 1 from public.events e
     where e.id = p_event_id and e.user_id = v_user_id
       and e.paid = false and e.test_activated_at is null
  );
end;
$$;

alter function public.get_event_test_activation_capability(bigint) owner to postgres;
revoke all on function public.get_event_test_activation_capability(bigint) from public, anon;
grant execute on function public.get_event_test_activation_capability(bigint) to authenticated;

create or replace function public.activate_event_for_test(p_event_id bigint)
returns table (event_id bigint, test_activated_at timestamptz, test_activated_by uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := public.get_authoritative_deployment_mode();
  v_user_id uuid := auth.uid();
  v_enabled boolean := false;
begin
  if v_mode <> 'cloud' then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_CLOUD_ONLY';
  end if;
  if v_user_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_AUTH_REQUIRED';
  end if;
  select cloud_test_activation_enabled into v_enabled
    from public.app_deployment_config where id = true;
  if not coalesce(v_enabled, false) then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_DISABLED';
  end if;
  if not exists (select 1 from public.app_cloud_test_activators where user_id = v_user_id) then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception using errcode = 'P0002', message = 'EVENT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.user_id = v_user_id) then
    raise exception using errcode = '42501', message = 'EVENT_OWNER_REQUIRED';
  end if;
  if exists (select 1 from public.events e where e.id = p_event_id and e.paid) then
    raise exception using errcode = '22023', message = 'EVENT_ALREADY_PAID';
  end if;
  if exists (select 1 from public.events e where e.id = p_event_id and e.test_activated_at is not null) then
    raise exception using errcode = '22023', message = 'EVENT_ALREADY_TEST_ACTIVATED';
  end if;
  return query
  update public.events e
     set test_activated_at = clock_timestamp(), test_activated_by = v_user_id
   where e.id = p_event_id
  returning e.id, e.test_activated_at, e.test_activated_by;
end;
$$;

alter function public.activate_event_for_test(bigint) owner to postgres;
revoke all on function public.activate_event_for_test(bigint) from public, anon;
grant execute on function public.activate_event_for_test(bigint) to authenticated;

commit;
