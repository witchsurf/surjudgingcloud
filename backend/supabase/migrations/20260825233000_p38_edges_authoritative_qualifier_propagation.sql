begin;

-- P3.8 stores the canonical qualifier graph with opaque heat ids.  Keep the
-- historic mapping implementation below as a fallback for edge-less events,
-- but never let it add destinations to a category that has a competition
-- progression graph.
create or replace function public.fn_propagate_qualifiers_for_source_heat(p_source_heat_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source record;
  v_target record;
  v_mapping record;
  v_edge record;
  v_ranked_participant_id bigint;
  v_ranked_seed integer;
  v_best_second_participant_id bigint;
  v_best_second_seed integer;
  v_best_second_loaded boolean := false;
  v_has_p38_competition_graph boolean := false;
  v_updated integer := 0;
begin
  select h.id, h.event_id, h.division, h.round, h.heat_number
    into v_source
  from public.heats h
  where h.id = trim(p_source_heat_id)
  limit 1;

  if not found then
    return 0;
  end if;

  select exists (
    select 1
    from public.heat_progression_edges edge
    where edge.event_id = v_source.event_id
      and lower(trim(coalesce(edge.category, ''))) = lower(trim(coalesce(v_source.division, '')))
      and upper(trim(coalesce(edge.progression_type, ''))) = 'COMPETITION_RESULT'
  )
  into v_has_p38_competition_graph;

  if v_has_p38_competition_graph then
    -- A P3.8 category is authoritative from its graph.  Do not inspect or
    -- infer heat_slot_mappings here: they may be legacy remnants.
    for v_edge in
      select edge.target_heat_id, edge.target_position, edge.source_position,
             target.color_order
      from public.heat_progression_edges edge
      join public.heats target on target.id = edge.target_heat_id
      where edge.event_id = v_source.event_id
        and lower(trim(coalesce(edge.category, ''))) = lower(trim(coalesce(v_source.division, '')))
        and edge.source_heat = v_source.id
        and upper(trim(coalesce(edge.progression_type, ''))) = 'COMPETITION_RESULT'
        and target.event_id = v_source.event_id
        and lower(trim(coalesce(target.division, ''))) = lower(trim(coalesce(v_source.division, '')))
      order by edge.target_heat_id, edge.target_position
    loop
      if v_edge.source_position is null or v_edge.target_position is null then
        continue;
      end if;

      select ranked.participant_id, ranked.seed
        into v_ranked_participant_id, v_ranked_seed
      from public.fn_rank_heat_entries_from_scores(v_source.id) ranked
      where ranked.rank_pos = v_edge.source_position
      limit 1;

      -- An unresolved sports result must remain an unresolved slot, not a
      -- materialized heat entry with a NULL participant.
      if v_ranked_participant_id is null then
        continue;
      end if;

      insert into public.heat_entries (heat_id, participant_id, position, seed, color)
      values (
        v_edge.target_heat_id,
        v_ranked_participant_id,
        v_edge.target_position,
        coalesce(v_ranked_seed, v_edge.target_position),
        coalesce(v_edge.color_order[v_edge.target_position], case v_edge.target_position
          when 1 then 'RED'
          when 2 then 'WHITE'
          when 3 then 'YELLOW'
          when 4 then 'BLUE'
          when 5 then 'GREEN'
          when 6 then 'BLACK'
          else null
        end)
      )
      on conflict (heat_id, position) do update
        set participant_id = excluded.participant_id,
            seed = excluded.seed,
            color = coalesce(excluded.color, public.heat_entries.color);

      v_updated := v_updated + 1;
    end loop;

    return v_updated;
  end if;

  -- Legacy fallback: unchanged mapping-driven propagation for categories that
  -- have no P3.8 COMPETITION_RESULT graph at all.
  for v_target in
    select h.id, h.color_order
    from public.heats h
    where h.event_id = v_source.event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_source.division, '')))
      and h.round = v_source.round + 1
    order by h.heat_number asc
  loop
    if not exists (
      select 1
      from public.heat_slot_mappings hm
      where hm.heat_id = v_target.id
        and (
          (
            hm.source_round is not null
            and hm.source_heat is not null
            and hm.source_position is not null
          )
          or upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
        )
    ) then
      insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
      select inferred.heat_id, inferred.slot_position, inferred.placeholder, inferred.source_round, inferred.source_heat, inferred.source_position
      from public.fn_infer_heat_slot_mappings_for_heat(v_target.id) inferred
      on conflict (heat_id, position) do update
        set placeholder = excluded.placeholder,
            source_round = excluded.source_round,
            source_heat = excluded.source_heat,
            source_position = excluded.source_position;
    end if;

    v_best_second_participant_id := null;
    v_best_second_seed := null;
    v_best_second_loaded := false;

    for v_mapping in
      with resolved_mappings as (
        select
          hm.heat_id,
          hm.position,
          coalesce(
            hm.source_round,
            (case when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
              then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[2]::integer end)
          ) as resolved_source_round,
          coalesce(
            hm.source_heat,
            (case when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
              then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[3]::integer end)
          ) as resolved_source_heat,
          coalesce(
            hm.source_position,
            (case when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
              then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[4]::integer end)
          ) as resolved_source_position,
          (case when upper(trim(coalesce(hm.placeholder, ''))) ~ 'MEILLEUR[[:space:]]*2E[[:space:]]*R[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'MEILLEUR[[:space:]]*2E[[:space:]]*R([0-9]+)'))[1]::integer end) as resolved_best_second_round
        from public.heat_slot_mappings hm
        where hm.heat_id = v_target.id
      )
      select resolved_mappings.heat_id, resolved_mappings.position,
             resolved_mappings.resolved_source_position as source_position,
             resolved_mappings.resolved_best_second_round as best_second_round
      from resolved_mappings
      where (resolved_mappings.resolved_source_round = v_source.round and resolved_mappings.resolved_source_heat = v_source.heat_number)
         or resolved_mappings.resolved_best_second_round = v_source.round
      order by resolved_mappings.position asc
    loop
      v_ranked_participant_id := null;
      v_ranked_seed := null;

      if v_mapping.best_second_round is not null then
        if not v_best_second_loaded then
          select best_second.participant_id, best_second.seed
            into v_best_second_participant_id, v_best_second_seed
          from public.fn_best_second_heat_entry_for_round(v_source.event_id, v_source.division, v_mapping.best_second_round) best_second
          limit 1;
          v_best_second_loaded := true;
        end if;
        v_ranked_participant_id := v_best_second_participant_id;
        v_ranked_seed := v_best_second_seed;
      else
        select ranked.participant_id, ranked.seed
          into v_ranked_participant_id, v_ranked_seed
        from public.fn_rank_heat_entries_from_scores(v_source.id) ranked
        where ranked.rank_pos = v_mapping.source_position
        limit 1;
      end if;

      insert into public.heat_entries (heat_id, participant_id, position, seed, color)
      values (v_target.id, v_ranked_participant_id, v_mapping.position,
        coalesce(v_ranked_seed, v_mapping.position),
        coalesce(v_target.color_order[v_mapping.position], case v_mapping.position
          when 1 then 'RED' when 2 then 'WHITE' when 3 then 'YELLOW'
          when 4 then 'BLUE' when 5 then 'GREEN' when 6 then 'BLACK' else null end))
      on conflict (heat_id, position) do update
        set participant_id = excluded.participant_id,
            seed = excluded.seed,
            color = coalesce(excluded.color, public.heat_entries.color);
      v_updated := v_updated + 1;
    end loop;
  end loop;

  return v_updated;
end;
$$;

grant execute on function public.fn_propagate_qualifiers_for_source_heat(text) to anon, authenticated, service_role;

commit;
