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

create or replace function public.fn_sync_active_heat_pointer_identity()
returns trigger
language plpgsql
as $$
declare
  heat_row record;
begin
  if new.active_heat_id is not null then
    select h.event_id, h.competition
      into heat_row
    from public.heats h
    where h.id = new.active_heat_id;

    if found then
      new.event_id := heat_row.event_id;
      if coalesce(trim(new.event_name), '') = '' then
        new.event_name := heat_row.competition;
      end if;
    end if;
  end if;

  if new.event_id is not null then
    select e.name
      into new.event_name
    from public.events e
    where e.id = new.event_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_active_heat_pointer_sync_identity on public.active_heat_pointer;

create trigger trg_active_heat_pointer_sync_identity
  before insert or update of active_heat_id, event_id, event_name
  on public.active_heat_pointer
  for each row
  execute function public.fn_sync_active_heat_pointer_identity();
