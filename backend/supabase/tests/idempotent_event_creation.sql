-- Run after the migration inside an outer transaction; this file leaves no data.
update public.app_deployment_config set deployment_mode = 'field' where id = true;
set local role anon;
select set_config('request.headers', '{"host":"kong:8000"}', true);
select set_config('request.jwt.claims', '{}', true);

do $$
declare
  v_first record;
  v_retry record;
  v_count integer;
begin
  select * into v_first from public.create_event_secure(
    'IDEMPOTENCY PROBE 20260901', 'Test', current_date, current_date,
    0, 'XOF', '[]', '[]', 'b8f20db0-4f7f-44e4-a32b-9793a966f5d5'::uuid
  );
  select * into v_retry from public.create_event_secure(
    'IDEMPOTENCY PROBE 20260901', 'Test', current_date, current_date,
    0, 'XOF', '[]', '[]', 'b8f20db0-4f7f-44e4-a32b-9793a966f5d5'::uuid
  );
  if v_first.id is null or v_retry.id <> v_first.id then
    raise exception 'same request key did not return the original event';
  end if;
  select count(*) into v_count from public.events where id = v_first.id;
  if v_count <> 1 then
    raise exception 'idempotent request inserted % events', v_count;
  end if;
  begin
    perform * from public.create_event_secure(
      'IDEMPOTENCY PROBE 20260901', 'Test', current_date, current_date,
      0, 'XOF', '[]', '[]', 'e1e7aadb-2a37-4e72-bd79-6ad6d5414381'::uuid
    );
    raise exception 'different key unexpectedly bypassed event-name uniqueness';
  exception when unique_violation then
    if sqlerrm <> 'EVENT_NAME_ALREADY_EXISTS' then raise; end if;
  end;
end;
$$;

reset role;
