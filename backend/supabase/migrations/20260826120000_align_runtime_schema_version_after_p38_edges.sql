begin;

-- The P3.8 edge-aware propagation migration must already be present before
-- this marker is advanced. This migration intentionally touches no business
-- data: it only aligns the singleton runtime-schema marker with the latest
-- applied application migration.
do $$
begin
  if to_regclass('public.app_runtime_schema_version') is null then
    raise exception 'app_runtime_schema_version is required before aligning the runtime schema marker';
  end if;

  if to_regclass('public.heat_progression_edges') is null then
    raise exception 'P3.8 heat_progression_edges is required before aligning the runtime schema marker';
  end if;

  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'fn_propagate_qualifiers_for_source_heat'
  ) then
    raise exception 'P3.8 qualifier propagation function is required before aligning the runtime schema marker';
  end if;

  insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
  values (
    true,
    '20260826120000_align_runtime_schema_version_after_p38_edges',
    'Align runtime schema marker after P3.8 edge-aware qualifier propagation',
    now()
  )
  on conflict (id) do update
  set schema_version = excluded.schema_version,
      schema_label = excluded.schema_label,
      updated_at = excluded.updated_at;
end;
$$;

commit;
