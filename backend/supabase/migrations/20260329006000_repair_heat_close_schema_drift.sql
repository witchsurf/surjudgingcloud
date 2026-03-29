alter table public.heat_realtime_config
  drop constraint if exists heat_realtime_config_status_check;

alter table public.heat_realtime_config
  add constraint heat_realtime_config_status_check
  check (status in ('waiting', 'running', 'paused', 'finished', 'closed'));

alter table public.active_heat_pointer
  add column if not exists event_id bigint references public.events(id) on delete cascade;

update public.active_heat_pointer pointer
set event_id = heat.event_id
from public.heats heat
where heat.id = pointer.active_heat_id
  and heat.event_id is not null
  and pointer.event_id is distinct from heat.event_id;

update public.active_heat_pointer pointer
set event_id = event_row.id
from public.events event_row
where pointer.event_id is null
  and lower(trim(coalesce(pointer.event_name, ''))) = lower(trim(coalesce(event_row.name, '')));

create unique index if not exists idx_active_heat_pointer_event_id_unique
  on public.active_heat_pointer(event_id)
  where event_id is not null;
