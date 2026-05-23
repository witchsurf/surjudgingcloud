do $$
declare
  source_tenant record;
begin
  select *
    into source_tenant
    from _realtime.tenants
   where external_id = 'realtime-dev'
   limit 1;

  if not found then
    raise notice 'Realtime tenant realtime-dev not found, skipping alias repair';
    return;
  end if;

  insert into _realtime.tenants (
    id,
    name,
    external_id,
    jwt_secret,
    postgres_cdc_default,
    max_concurrent_users,
    max_events_per_second,
    max_bytes_per_second,
    max_channels_per_client,
    max_joins_per_second,
    suspend,
    inserted_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    'surfjudging_realtime',
    'surfjudging_realtime',
    source_tenant.jwt_secret,
    source_tenant.postgres_cdc_default,
    source_tenant.max_concurrent_users,
    source_tenant.max_events_per_second,
    source_tenant.max_bytes_per_second,
    source_tenant.max_channels_per_client,
    source_tenant.max_joins_per_second,
    source_tenant.suspend,
    now(),
    now()
  )
  on conflict (external_id) do update
    set jwt_secret = excluded.jwt_secret,
        postgres_cdc_default = excluded.postgres_cdc_default,
        max_concurrent_users = excluded.max_concurrent_users,
        max_events_per_second = excluded.max_events_per_second,
        max_bytes_per_second = excluded.max_bytes_per_second,
        max_channels_per_client = excluded.max_channels_per_client,
        max_joins_per_second = excluded.max_joins_per_second,
        suspend = excluded.suspend,
        updated_at = excluded.updated_at;

  insert into _realtime.extensions (
    id,
    type,
    settings,
    tenant_external_id,
    inserted_at,
    updated_at
  )
  select
    gen_random_uuid(),
    type,
    settings,
    'surfjudging_realtime',
    now(),
    now()
  from _realtime.extensions
  where tenant_external_id = 'realtime-dev'
  on conflict (tenant_external_id, type) do update
    set settings = excluded.settings,
        updated_at = excluded.updated_at;
end
$$;
