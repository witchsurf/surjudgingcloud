begin;

-- Remove auxiliary privileges left by historical GRANT ALL statements. Runtime
-- browser writes use the narrow SECURITY DEFINER RPC introduced in 150000.
revoke truncate, references, trigger
on table public.heat_configs
from anon, authenticated;

-- MAINTAIN is a table privilege only since PostgreSQL 17. Keep this migration
-- bootstrappable on the PostgreSQL 15 field stack: the unsupported token must
-- not be parsed there.
do $$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on table public.heat_configs from anon, authenticated';
  end if;
end
$$;

-- Cloud history contained an explicit anon grant that is not inherited from
-- PUBLIC and therefore survived the function-level revoke in 150000.
revoke execute on function public.upsert_heat_config_runtime(
  text,
  text[],
  text[],
  jsonb,
  integer,
  text
) from anon;

-- State the intended retained capabilities without broadening browser writes.
grant select on table public.heat_configs to anon, authenticated;
grant execute on function public.upsert_heat_config_runtime(
  text,
  text[],
  text[],
  jsonb,
  integer,
  text
) to authenticated, service_role;

commit;
