begin;

do $$
declare
  v_role text;
  v_privilege text;
  v_table_privileges text[] := array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if not has_table_privilege(v_role, 'public.heat_configs', 'SELECT') then
      raise exception '% must retain SELECT on heat_configs', v_role;
    end if;

    foreach v_privilege in array v_table_privileges loop
      if has_table_privilege(v_role, 'public.heat_configs', v_privilege) then
        raise exception '% must not retain % on heat_configs', v_role, v_privilege;
      end if;
    end loop;

    if current_setting('server_version_num')::integer >= 170000
       and has_table_privilege(v_role, 'public.heat_configs', 'MAINTAIN') then
      raise exception '% must not retain MAINTAIN on heat_configs', v_role;
    end if;
  end loop;

  if has_function_privilege(
    'anon',
    'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute upsert_heat_config_runtime';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated and service_role must execute upsert_heat_config_runtime';
  end if;

  foreach v_privilege in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] loop
    if not has_table_privilege('service_role', 'public.heat_configs', v_privilege) then
      raise exception 'service_role must retain % on heat_configs', v_privilege;
    end if;
  end loop;

  if current_setting('server_version_num')::integer >= 170000
     and not has_table_privilege('service_role', 'public.heat_configs', 'MAINTAIN') then
    raise exception 'service_role must retain MAINTAIN on heat_configs';
  end if;

  if not (select relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'heat_configs') then
    raise exception 'RLS must remain enabled on heat_configs';
  end if;

  if (select schema_version from public.app_runtime_schema_version where id)
     <> '20260808180000_reconcile_heat_configs_acl_pg15_pg17' then
    raise exception 'runtime schema version must be 180000';
  end if;
end
$$;

rollback;
