begin;

create or replace function public.p38_category_policy_validate()
returns trigger
language plpgsql
as $$
begin
  if new.category is null or btrim(new.category) = '' then
    raise exception 'category is required';
  end if;
  if new.base_format not in ('elimination', 'repechage', 'man_on_man') then
    raise exception 'unsupported base format: %', new.base_format;
  end if;
  if new.transition_round is not null and new.transition_round < 2 then
    raise exception 'transition_round must be >= 2';
  end if;
  if new.transition_round is null and new.transition_format is not null then
    raise exception 'transition_format requires transition_round';
  end if;
  if new.transition_round is not null and new.transition_format is null then
    raise exception 'transition_format is required when transition_round is set';
  end if;
  if new.transition_format is not null and new.transition_format not in ('elimination', 'repechage', 'man_on_man') then
    raise exception 'unsupported transition format: %', new.transition_format;
  end if;
  if new.transition_format is not null and new.transition_format = new.base_format then
    raise exception 'transition format must differ from base format';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists p38_category_policy_validate on public.event_category_planning_config;
create trigger p38_category_policy_validate
before insert or update on public.event_category_planning_config
for each row execute function public.p38_category_policy_validate();

alter table public.event_category_planning_config enable row level security;
alter table public.heat_progression_edges enable row level security;
drop policy if exists p38_policy_select on public.event_category_planning_config;
drop policy if exists p38_policy_write on public.event_category_planning_config;
create policy p38_policy_select on public.event_category_planning_config for select using (true);
create policy p38_policy_write on public.event_category_planning_config for all using (true) with check (true);
drop policy if exists p38_edges_select on public.heat_progression_edges;
drop policy if exists p38_edges_write on public.heat_progression_edges;
create policy p38_edges_select on public.heat_progression_edges for select using (true);
create policy p38_edges_write on public.heat_progression_edges for all using (true) with check (true);
grant select, insert, update, delete on public.event_category_planning_config to anon, authenticated;
grant select, insert, update, delete on public.heat_progression_edges to anon, authenticated;
grant usage, select on sequence public.heat_progression_edges_id_seq to anon, authenticated;

commit;
