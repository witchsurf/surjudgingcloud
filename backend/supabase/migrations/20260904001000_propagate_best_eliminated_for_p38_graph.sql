begin;

-- P3.8 progression edges carry deterministic winners.  A best-eliminated
-- slot is deliberately represented by an explicit mapping instead: it is
-- resolved from every completed heat in a source round.  Resolve it only
-- once that complete round is closed, so an early result cannot select a
-- provisional athlete.
create or replace function public.fn_propagate_best_eliminated_for_source_heat(
  p_source_heat_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source record;
  v_best_second record;
  v_target record;
  v_updated integer := 0;
begin
  select h.id, h.event_id, h.division, h.round
    into v_source
  from public.heats h
  where h.id = trim(p_source_heat_id);

  if not found then
    return 0;
  end if;

  -- A wildcard is definitive only when every peer heat of its source round
  -- has closed.  This also makes repeated close notifications idempotent.
  if exists (
    select 1
    from public.heats peer
    where peer.event_id = v_source.event_id
      and lower(trim(coalesce(peer.division, ''))) = lower(trim(coalesce(v_source.division, '')))
      and peer.round = v_source.round
      and peer.status is distinct from 'closed'
  ) then
    return 0;
  end if;

  select *
    into v_best_second
  from public.fn_best_second_heat_entry_for_round(
    v_source.event_id,
    v_source.division,
    v_source.round
  )
  limit 1;

  if v_best_second.participant_id is null then
    return 0;
  end if;

  for v_target in
    select target.id, mapping.position, target.color_order
    from public.heat_slot_mappings mapping
    join public.heats target on target.id = mapping.heat_id
    where target.event_id = v_source.event_id
      and lower(trim(coalesce(target.division, ''))) = lower(trim(coalesce(v_source.division, '')))
      and target.round = v_source.round + 1
      and upper(trim(coalesce(mapping.placeholder, ''))) ~
        ('^MEILLEUR[[:space:]]+[0-9]+E[[:space:]]+R' || v_source.round::text || '$')
    order by target.id, mapping.position
  loop
    -- Scores belong to the lycra colour.  A previously unresolved slot can
    -- therefore be named safely even after a judge entered a score, but a
    -- scored slot that already names another participant must never be
    -- rewritten automatically.
    if exists (
      select 1
      from public.heat_entries entry
      where entry.heat_id = v_target.id
        and entry.position = v_target.position
        and entry.participant_id is not null
        and entry.participant_id is distinct from v_best_second.participant_id
    ) and exists (
      select 1
      from public.scores score
      where score.heat_id = v_target.id
    ) then
      continue;
    end if;

    insert into public.heat_entries (heat_id, participant_id, position, seed, color)
    values (
      v_target.id,
      v_best_second.participant_id,
      v_target.position,
      coalesce(v_best_second.seed, v_target.position),
      coalesce(v_target.color_order[v_target.position], case v_target.position
        when 1 then 'RED' when 2 then 'WHITE' when 3 then 'YELLOW'
        when 4 then 'BLUE' when 5 then 'GREEN' when 6 then 'BLACK' else null end)
    )
    on conflict (heat_id, position) do update
      set participant_id = excluded.participant_id,
          seed = excluded.seed,
          color = coalesce(excluded.color, public.heat_entries.color);

    v_updated := v_updated + 1;
  end loop;

  return v_updated;
end;
$$;

create or replace function public.fn_propagate_best_eliminated_after_heat_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    perform public.fn_propagate_best_eliminated_for_source_heat(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_propagate_best_eliminated_after_heat_close on public.heats;
create trigger trg_propagate_best_eliminated_after_heat_close
after update of status on public.heats
for each row execute function public.fn_propagate_best_eliminated_after_heat_close();

grant execute on function public.fn_propagate_best_eliminated_for_source_heat(text)
  to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260904001000_propagate_best_eliminated_for_p38_graph',
  'Propagate best eliminated qualifiers after a complete source round closes',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
