\set ON_ERROR_STOP on

update public.app_deployment_config
   set deployment_mode = 'field', provisioned_at = now()
 where id = true;

do $$
begin
  if public.get_authoritative_deployment_mode() <> 'field' then
    raise exception 'FIELD_DEPLOYMENT_MODE_PROVISIONING_FAILED';
  end if;
end;
$$;
