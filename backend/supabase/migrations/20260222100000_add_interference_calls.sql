-- Interference calls per judge with majority/head-judge resolution handled in app logic.
create table if not exists public.interference_calls (
  id bigserial primary key,
  event_id bigint null references public.events(id) on delete cascade,
  heat_id text not null references public.heats(id) on delete cascade,
  competition text null,
  division text null,
  round integer null,
  judge_id text not null,
  judge_name text null,
  surfer text not null,
  wave_number integer not null check (wave_number > 0),
  call_type text not null check (call_type in ('INT1', 'INT2')),
  is_head_judge_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (heat_id, judge_id, surfer, wave_number)
);

create index if not exists idx_interference_calls_heat_id on public.interference_calls(heat_id);
create index if not exists idx_interference_calls_event_id on public.interference_calls(event_id);
create index if not exists idx_interference_calls_surfer on public.interference_calls(heat_id, surfer);

create or replace function public.touch_interference_calls_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_interference_calls_updated_at on public.interference_calls;
create trigger trg_interference_calls_updated_at
before update on public.interference_calls
for each row
execute function public.touch_interference_calls_updated_at();

alter table public.interference_calls enable row level security;

drop policy if exists interference_calls_read_all on public.interference_calls;
create policy interference_calls_read_all
on public.interference_calls
for select
using (true);

drop policy if exists interference_calls_insert_all on public.interference_calls;
create policy interference_calls_insert_all
on public.interference_calls
for insert
with check (true);

drop policy if exists interference_calls_update_all on public.interference_calls;
create policy interference_calls_update_all
on public.interference_calls
for update
using (true)
with check (true);

drop policy if exists interference_calls_delete_all on public.interference_calls;
create policy interference_calls_delete_all
on public.interference_calls
for delete
using (true);

