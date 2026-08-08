begin;

-- Runtime writes now go through public.upsert_heat_config_runtime(). Keep public
-- reads for the field displays, but remove direct table writes from browser roles.
revoke insert, update, delete on table public.heat_configs from anon;
revoke insert, update, delete on table public.heat_configs from authenticated;

grant select on table public.heat_configs to anon, authenticated;

-- Operational copy/backup tooling uses a service-role Supabase client directly.
-- Preserve those maintenance capabilities while converging Cloud and Event Box.
grant all privileges on table public.heat_configs to service_role;

commit;
