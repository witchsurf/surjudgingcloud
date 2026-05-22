-- Runtime schema version exposed to field diagnostics.
-- The frontend compares this value with the latest migration known at build time.

create table if not exists public.app_runtime_schema_version (
  id boolean primary key default true,
  schema_version text not null,
  schema_label text,
  updated_at timestamp with time zone not null default now(),
  constraint app_runtime_schema_version_singleton check (id)
);

alter table public.app_runtime_schema_version enable row level security;

drop policy if exists "allow_public_read_app_runtime_schema_version" on public.app_runtime_schema_version;
create policy "allow_public_read_app_runtime_schema_version"
on public.app_runtime_schema_version
for select
to anon, authenticated
using (true);

grant select on public.app_runtime_schema_version to anon, authenticated;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260523010000_add_runtime_schema_version',
  'Runtime schema version diagnostics',
  now()
)
on conflict (id) do update
set
  schema_version = excluded.schema_version,
  schema_label = excluded.schema_label,
  updated_at = now();
