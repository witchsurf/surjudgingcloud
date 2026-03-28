update public.heat_judge_assignments assignment
set event_id = heat.event_id
from public.heats heat
where heat.id = assignment.heat_id
  and heat.event_id is not null
  and assignment.event_id is distinct from heat.event_id;

create or replace function public.fn_sync_heat_judge_assignment_event_id()
returns trigger
language plpgsql
as $$
begin
  if new.heat_id is not null then
    select h.event_id
      into new.event_id
    from public.heats h
    where h.id = new.heat_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_heat_judge_assignments_sync_event_id on public.heat_judge_assignments;

create trigger trg_heat_judge_assignments_sync_event_id
  before insert or update of heat_id, event_id
  on public.heat_judge_assignments
  for each row
  execute function public.fn_sync_heat_judge_assignment_event_id();
