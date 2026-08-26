-- The Field bundle derives its expected schema version from the latest migration.
-- Keep the runtime marker in the same transaction so an upgraded database never
-- reports itself as older than the frontend that requires this guard.
begin;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260826210000_align_runtime_schema_version_after_progression_guard',
  'Explicit progression graph guard',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
