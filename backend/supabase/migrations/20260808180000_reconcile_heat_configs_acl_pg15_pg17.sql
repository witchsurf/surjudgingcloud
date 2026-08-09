begin;

-- Cross-version reconciliation for the PostgreSQL 15 Event Box and the
-- PostgreSQL 17 Cloud. MAINTAIN does not exist before PostgreSQL 17, so its SQL
-- token must only be parsed through dynamic SQL on servers which support it.
revoke truncate, references, trigger
on table public.heat_configs
from anon, authenticated;

do $$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on table public.heat_configs from anon, authenticated';
  end if;
end
$$;

revoke execute on function public.upsert_heat_config_runtime(
  text,
  text[],
  text[],
  jsonb,
  integer,
  text
) from anon;

grant select on table public.heat_configs to anon, authenticated;
grant execute on function public.upsert_heat_config_runtime(
  text,
  text[],
  text[],
  jsonb,
  integer,
  text
) to authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (true, '20260808180000_reconcile_heat_configs_acl_pg15_pg17', null, now())
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

commit;
