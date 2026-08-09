begin;

create or replace function public.configure_cloud_test_activation(
  p_enabled boolean,
  p_user_id uuid default null,
  p_authorized boolean default false,
  p_authorized_by text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if public.get_authoritative_deployment_mode() <> 'cloud' then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_CLOUD_ONLY';
  end if;

  update public.app_deployment_config
     set cloud_test_activation_enabled = coalesce(p_enabled, false),
         provisioned_at = now()
   where id = true;

  if p_user_id is not null and p_authorized then
    insert into public.app_cloud_test_activators (user_id, authorized_at, authorized_by)
    values (p_user_id, now(), nullif(btrim(p_authorized_by), ''))
    on conflict (user_id) do update
      set authorized_at = excluded.authorized_at,
          authorized_by = excluded.authorized_by;
  elsif p_user_id is not null then
    delete from public.app_cloud_test_activators where user_id = p_user_id;
  end if;
end;
$$;

alter function public.configure_cloud_test_activation(boolean,uuid,boolean,text) owner to postgres;
revoke all on function public.configure_cloud_test_activation(boolean,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.configure_cloud_test_activation(boolean,uuid,boolean,text) to service_role;

commit;
