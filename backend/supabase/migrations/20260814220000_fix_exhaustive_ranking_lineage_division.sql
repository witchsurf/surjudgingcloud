-- P2.7.77: disambiguate previous-round lineage by the destination division.
-- Multiple divisions may reuse round/heat coordinates within one event.
create or replace function public.fn_rank_heat_entries_exhaustive(p_heat_id text)
returns table (rank_pos integer, participant_id bigint, seed integer, color text, best_two numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with target as (
    select h.event_id, h.division
    from public.heats h where h.id = trim(p_heat_id)
  ),
  entries as (
    select e.heat_id, e.participant_id, e.seed, e.position, e.color
    from public.heat_entries e
    where e.heat_id = trim(p_heat_id) and e.participant_id is not null
  ),
  scored as (
    select s.color, s.best_two
    from public.fn_rank_heat_entries_scored_only(trim(p_heat_id)) s
  ),
  lineage as (
    select e.position, previous.best_two as previous_round_total
    from entries e
    left join public.heat_slot_mappings mapping
      on mapping.heat_id = e.heat_id and mapping.position = e.position
    left join public.heats source_heat
      on source_heat.event_id = (select event_id from target)
     and lower(trim(source_heat.division)) = lower(trim((select division from target)))
     and source_heat.round = mapping.source_round
     and source_heat.heat_number = mapping.source_heat
    left join lateral (
      select ranked.best_two
      from public.fn_rank_heat_entries_scored_only(source_heat.id) ranked
      where ranked.rank_pos = mapping.source_position
      limit 1
    ) previous on true
  ),
  candidates as (
    select e.participant_id, e.seed, e.position, e.color,
      coalesce(scored.best_two, 0::numeric) as current_total,
      lineage.previous_round_total
    from entries e
    left join scored on public.fn_normalize_jersey_label_sql(scored.color) = public.fn_normalize_jersey_label_sql(e.color)
    left join lineage on lineage.position = e.position
  ),
  ranked as (
    select candidates.*, dense_rank() over (
      order by candidates.current_total desc,
        candidates.previous_round_total desc nulls last,
        candidates.seed asc nulls last, candidates.position asc,
        public.fn_normalize_jersey_label_sql(candidates.color) asc
    )::integer as computed_rank
    from candidates
  )
  select computed_rank, participant_id, seed, color, current_total
  from ranked order by computed_rank, position;
$$;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version(id,schema_version,updated_at)
    values (true,'20260814220000_fix_exhaustive_ranking_lineage_division',now())
    on conflict (id) do update set schema_version=excluded.schema_version,updated_at=excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
