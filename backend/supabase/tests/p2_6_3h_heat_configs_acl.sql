begin;

do $$
begin
  if not has_table_privilege('anon', 'public.heat_configs', 'SELECT')
     or not has_table_privilege('authenticated', 'public.heat_configs', 'SELECT') then
    raise exception 'anon and authenticated must retain SELECT on heat_configs';
  end if;

  if has_table_privilege('anon', 'public.heat_configs', 'INSERT')
     or has_table_privilege('anon', 'public.heat_configs', 'UPDATE')
     or has_table_privilege('anon', 'public.heat_configs', 'DELETE') then
    raise exception 'anon must not write heat_configs directly';
  end if;

  if has_table_privilege('authenticated', 'public.heat_configs', 'INSERT')
     or has_table_privilege('authenticated', 'public.heat_configs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.heat_configs', 'DELETE') then
    raise exception 'authenticated must not write heat_configs directly';
  end if;

  if not has_table_privilege('service_role', 'public.heat_configs', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'service_role operational access to heat_configs must be preserved';
  end if;

  if has_function_privilege('public', 'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)', 'EXECUTE') then
    raise exception 'PUBLIC must not execute upsert_heat_config_runtime';
  end if;

  if not has_function_privilege('authenticated', 'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)', 'EXECUTE') then
    raise exception 'authenticated and service_role must execute upsert_heat_config_runtime';
  end if;
end
$$;

rollback;
