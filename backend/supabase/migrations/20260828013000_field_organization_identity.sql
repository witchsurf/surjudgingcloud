begin;

create table if not exists public.field_organization_profile (
  id boolean primary key default true check (id = true),
  organization_name text not null,
  logo_data_url text not null,
  updated_at timestamptz not null default now(),
  constraint field_organization_name_length
    check (char_length(btrim(organization_name)) between 2 and 120),
  constraint field_organization_logo_png
    check (
      logo_data_url like 'data:image/png;base64,%'
      and octet_length(logo_data_url) between 32 and 2097152
    )
);

alter table public.field_organization_profile enable row level security;
revoke all on table public.field_organization_profile from public, anon, authenticated;
grant select on table public.field_organization_profile to anon, authenticated;

drop policy if exists field_organization_profile_read_field
  on public.field_organization_profile;
create policy field_organization_profile_read_field
  on public.field_organization_profile
  for select
  to anon, authenticated
  using (public.get_authoritative_deployment_mode() = 'field');

create or replace function public.upsert_field_organization_profile(
  p_organization_name text,
  p_logo_data_url text
)
returns public.field_organization_profile
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_organization_name, ''));
  v_profile public.field_organization_profile;
begin
  if public.get_authoritative_deployment_mode() <> 'field' then
    raise exception using errcode = '42501', message = 'FIELD_RUNTIME_REQUIRED';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'ORGANIZATION_NAME_INVALID';
  end if;
  if p_logo_data_url is null
     or p_logo_data_url not like 'data:image/png;base64,%'
     or octet_length(p_logo_data_url) not between 32 and 2097152 then
    raise exception using errcode = '22023', message = 'ORGANIZATION_LOGO_INVALID';
  end if;

  insert into public.field_organization_profile (
    id, organization_name, logo_data_url, updated_at
  ) values (
    true, v_name, p_logo_data_url, now()
  )
  on conflict (id) do update
    set organization_name = excluded.organization_name,
        logo_data_url = excluded.logo_data_url,
        updated_at = excluded.updated_at
  returning * into v_profile;

  return v_profile;
end;
$$;

alter function public.upsert_field_organization_profile(text, text) owner to postgres;
revoke all on function public.upsert_field_organization_profile(text, text) from public;
grant execute on function public.upsert_field_organization_profile(text, text) to anon, authenticated;

comment on table public.field_organization_profile is
  'Singleton identity published by the local Field desktop. It is readable only in authoritative Field mode.';
comment on function public.upsert_field_organization_profile(text, text) is
  'Field-only organization identity publication. Cloud execution fails closed.';

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260828013000_field_organization_identity',
  'Field organization identity shared by landing and official PDFs',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
