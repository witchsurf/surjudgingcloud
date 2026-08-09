begin;

alter table public.events enable row level security;

-- Historical public readers accidentally bypass every owner policy because
-- permissive PostgreSQL policies are OR-ed together.
drop policy if exists "Allow anonymous read events" on public.events;
drop policy if exists "Allow public read events" on public.events;
drop policy if exists read_events on public.events;
drop policy if exists read_events_basic on public.events;
drop policy if exists authenticated_read on public.events;

-- paid/status are payment/workflow state, not publication state.
drop policy if exists events_read_own_or_paid on public.events;
drop policy if exists read_own_or_paid_events on public.events;
drop policy if exists events_read_own on public.events;
drop policy if exists events_read_cloud_owner on public.events;

do $policy$
declare
  v_has_user_id boolean;
  v_has_owner_id boolean;
begin
  select exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'user_id' and not attisdropped
  ) into v_has_user_id;
  select exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) into v_has_owner_id;

  if v_has_user_id and v_has_owner_id then
    execute $sql$
      create policy events_read_cloud_owner
      on public.events
      for select
      to authenticated
      using (
        auth.uid() is not null
        and (user_id = auth.uid() or owner_id = auth.uid())
      )
    $sql$;
  elsif v_has_user_id then
    execute $sql$
      create policy events_read_cloud_owner
      on public.events
      for select
      to authenticated
      using (auth.uid() is not null and user_id = auth.uid())
    $sql$;
  elsif v_has_owner_id then
    execute $sql$
      create policy events_read_cloud_owner
      on public.events
      for select
      to authenticated
      using (auth.uid() is not null and owner_id = auth.uid())
    $sql$;
  else
    raise exception using
      errcode = '55000',
      message = 'EVENTS_OWNERSHIP_COLUMN_MISSING';
  end if;
end;
$policy$;

-- events_read_authoritative_field is intentionally preserved. It opens local
-- reads only when the server-provisioned authoritative mode is exactly field.

commit;
