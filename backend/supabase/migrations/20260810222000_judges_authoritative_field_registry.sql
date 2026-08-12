begin;

-- ============================================================
-- SurfJudging — official judges registry convergence
--
-- Restores the historical public.judges registry when absent.
-- Cloud keeps the historical access model.
-- Anonymous writes are permitted ONLY on authoritative Field DBs.
-- ============================================================

create table if not exists public.judges (
    id text primary key default gen_random_uuid()::text,
    name text not null,
    personal_code text not null default '',
    email text,
    phone text,
    certification_level text,
    federation text not null default 'FSS',
    active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.judges enable row level security;

-- ------------------------------------------------------------
-- Privileges
-- RLS still decides which rows/actions are actually permitted.
-- ------------------------------------------------------------

grant select, insert, update, delete
on public.judges
to authenticated;

grant select, insert, update, delete
on public.judges
to anon;

grant all
on public.judges
to service_role;

-- ------------------------------------------------------------
-- Remove obsolete/local permissive policies if present
-- ------------------------------------------------------------

drop policy if exists judges_public_read
on public.judges;

drop policy if exists judges_anon_authenticated_insert
on public.judges;

drop policy if exists judges_anon_authenticated_update
on public.judges;

drop policy if exists judges_authenticated_delete
on public.judges;

drop policy if exists "Authenticated users can manage judges"
on public.judges;

drop policy if exists "Active judges are viewable by everyone"
on public.judges;

drop policy if exists "Authenticated users can view all judges"
on public.judges;

drop policy if exists "Authenticated users can insert judges"
on public.judges;

drop policy if exists "Authenticated users can update judges"
on public.judges;

drop policy if exists "Authenticated users can delete judges"
on public.judges;

drop policy if exists judges_insert_authoritative_field
on public.judges;

drop policy if exists judges_update_authoritative_field
on public.judges;

drop policy if exists judges_delete_authoritative_field
on public.judges;

-- ------------------------------------------------------------
-- Historical Cloud/read behaviour
-- ------------------------------------------------------------

create policy "Active judges are viewable by everyone"
on public.judges
for select
to anon
using (active = true);

create policy "Authenticated users can view all judges"
on public.judges
for select
to authenticated
using (true);

create policy "Authenticated users can insert judges"
on public.judges
for insert
to authenticated
with check (true);

create policy "Authenticated users can update judges"
on public.judges
for update
to authenticated
using (true)
with check (true);

create policy "Authenticated users can delete judges"
on public.judges
for delete
to authenticated
using (true);

-- ------------------------------------------------------------
-- FIELD anonymous write contract
--
-- These policies become true only when THIS DB declares itself
-- authoritative Field. They therefore do not open Cloud writes.
-- ------------------------------------------------------------

create policy judges_insert_authoritative_field
on public.judges
for insert
to anon
with check (
    public.get_authoritative_deployment_mode() = 'field'
);

create policy judges_update_authoritative_field
on public.judges
for update
to anon
using (
    public.get_authoritative_deployment_mode() = 'field'
)
with check (
    public.get_authoritative_deployment_mode() = 'field'
);

create policy judges_delete_authoritative_field
on public.judges
for delete
to anon
using (
    public.get_authoritative_deployment_mode() = 'field'
);

commit;
