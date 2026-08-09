begin;

do $$
declare
  v_host text;
  v_headers jsonb;
begin
  if public.get_authoritative_deployment_mode() <> 'cloud' then
    raise exception 'reconstruction must default safely to cloud';
  end if;

  foreach v_headers in array array[
    '{"host":"127.0.0.1:54321"}'::jsonb,
    '{"host":"localhost"}'::jsonb,
    '{"host":"kong:8000"}'::jsonb,
    '{"host":"arbitrary.example"}'::jsonb,
    '{"host":"project.supabase.co","x-forwarded-host":"localhost"}'::jsonb,
    '{"host":"10.0.0.10","x-forwarded-host":"priority.local"}'::jsonb
  ] loop
    perform set_config('request.headers', v_headers::text, true);
    perform set_config('request.jwt.claims', '{}', true);
    begin
      perform * from public.create_event_secure(
        'P2.6.6B SPOOF MUST FAIL', 'Security', current_date, current_date,
        0, 'XOF', '[]', '[]'
      );
      raise exception 'cloud mode accepted forged headers: %', v_headers;
    exception
      when insufficient_privilege then
        if sqlerrm <> 'CLOUD_AUTH_REQUIRED' then raise; end if;
    end;
  end loop;
end;
$$;

-- Provision Field exactly as the installer does, then prove that no Host is
-- required and the browser cannot mutate the singleton.
update public.app_deployment_config
   set deployment_mode = 'field', provisioned_at = now()
 where id = true;

set local role anon;
select set_config('request.headers', '', true);
select set_config('request.jwt.claims', '{}', true);
do $$
declare
  v_event record;
begin
  select * into v_event from public.create_event_secure(
    'P2.6.6B FIELD NO HOST', 'Security', current_date, current_date,
    0, 'XOF', '[]', '[]'
  );
  if pg_typeof(v_event.id)::text <> 'bigint' or v_event.user_id is not null then
    raise exception 'authoritative Field creation contract mismatch';
  end if;
  begin
    update public.app_deployment_config set deployment_mode = 'cloud' where id;
    raise exception 'anon unexpectedly changed deployment mode';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
