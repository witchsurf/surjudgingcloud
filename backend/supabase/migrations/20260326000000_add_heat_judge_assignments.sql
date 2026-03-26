create table if not exists public.heat_judge_assignments (
  id uuid primary key default gen_random_uuid(),
  heat_id text not null references public.heats(id) on delete cascade,
  event_id bigint references public.events(id) on delete cascade,
  station text not null,
  judge_id text not null,
  judge_name text not null,
  assigned_at timestamptz not null default now(),
  assigned_by text,
  updated_at timestamptz not null default now(),
  constraint heat_judge_assignments_station_check check (char_length(trim(station)) > 0),
  constraint heat_judge_assignments_judge_id_check check (char_length(trim(judge_id)) > 0),
  constraint heat_judge_assignments_judge_name_check check (char_length(trim(judge_name)) > 0),
  constraint heat_judge_assignments_heat_station_unique unique (heat_id, station)
);

create index if not exists idx_heat_judge_assignments_heat_id
  on public.heat_judge_assignments(heat_id);

create index if not exists idx_heat_judge_assignments_event_id
  on public.heat_judge_assignments(event_id);

create index if not exists idx_heat_judge_assignments_station
  on public.heat_judge_assignments(station);

alter table public.heat_judge_assignments enable row level security;

drop policy if exists public_read on public.heat_judge_assignments;
create policy public_read
  on public.heat_judge_assignments
  for select
  to anon, authenticated
  using (true);

drop policy if exists authenticated_insert on public.heat_judge_assignments;
create policy authenticated_insert
  on public.heat_judge_assignments
  for insert
  to authenticated
  with check (true);

drop policy if exists authenticated_update on public.heat_judge_assignments;
create policy authenticated_update
  on public.heat_judge_assignments
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists authenticated_delete on public.heat_judge_assignments;
create policy authenticated_delete
  on public.heat_judge_assignments
  for delete
  to authenticated
  using (true);

grant select on public.heat_judge_assignments to anon;
grant select, insert, update, delete on public.heat_judge_assignments to authenticated;
grant all on public.heat_judge_assignments to service_role;

drop trigger if exists update_heat_judge_assignments_updated_at on public.heat_judge_assignments;
create trigger update_heat_judge_assignments_updated_at
before update on public.heat_judge_assignments
for each row execute function public.update_updated_at_column();
