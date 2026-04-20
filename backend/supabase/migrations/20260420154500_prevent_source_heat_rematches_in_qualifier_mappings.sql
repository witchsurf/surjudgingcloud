begin;

create or replace function public.fn_infer_heat_slot_mappings_for_heat(p_target_heat_id text)
returns table (
  heat_id text,
  slot_position integer,
  placeholder text,
  source_round integer,
  source_heat integer,
  source_position integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target record;
  v_previous_round integer;
  v_total_current_slots integer := 0;
  v_requested_advancers integer := 0;
  v_heat_count integer := 0;
  v_heat_ids text[] := array[]::text[];
  v_capacities integer[] := array[]::integer[];
  v_counts integer[] := array[]::integer[];
  v_assignments jsonb[] := array[]::jsonb[];
  v_refs jsonb[] := array[]::jsonb[];
  v_idx integer := 1;
  v_direction integer := 1;
  v_guard integer;
  v_ref jsonb;
  v_ref_index integer;
  v_target_index integer;
  v_assignment jsonb;
  v_output_position integer := 0;
  v_position integer;
  v_candidate_idx integer;
  v_candidate_direction integer;
  v_fallback_idx integer;
  v_fallback_direction integer;
  v_chosen_idx integer;
  v_chosen_direction integer;
  v_has_collision boolean;
  source_heat_row record;
  current_heat_row record;
begin
  select h.id, h.event_id, h.division, h.round, h.heat_number, h.heat_size
    into v_target
  from public.heats h
  where h.id = trim(p_target_heat_id)
  limit 1;

  if not found or coalesce(v_target.round, 0) <= 1 then
    return;
  end if;

  v_previous_round := v_target.round - 1;

  for current_heat_row in
    select h.id, coalesce(h.heat_size, 0) as heat_size
    from public.heats h
    where h.event_id = v_target.event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
      and h.round = v_target.round
    order by h.heat_number asc
  loop
    v_heat_ids := array_append(v_heat_ids, current_heat_row.id);
    v_capacities := array_append(v_capacities, greatest(current_heat_row.heat_size, 0));
    v_counts := array_append(v_counts, 0);
    v_assignments := array_append(v_assignments, '[]'::jsonb);
    v_total_current_slots := v_total_current_slots + greatest(current_heat_row.heat_size, 0);
  end loop;

  v_heat_count := array_length(v_heat_ids, 1);
  if coalesce(v_heat_count, 0) = 0 or v_total_current_slots <= 0 then
    return;
  end if;

  select count(*)
    into v_requested_advancers
  from public.heats h
  where h.event_id = v_target.event_id
    and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
    and h.round = v_previous_round;

  if coalesce(v_requested_advancers, 0) = 0 then
    return;
  end if;

  v_requested_advancers := greatest(1, ceil(v_total_current_slots::numeric / v_requested_advancers)::integer);

  -- Build qualifier references by rank layer first: every P1, then every P2.
  -- This preserves the initial seeding/snake intent better than filling source heat by source heat.
  for v_position in 1..v_requested_advancers loop
    for source_heat_row in
      select h.round, h.heat_number, coalesce(h.heat_size, 0) as heat_size
      from public.heats h
      where h.event_id = v_target.event_id
        and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
        and h.round = v_previous_round
      order by h.heat_number asc
    loop
      if v_position <= least(
        case
          when source_heat_row.heat_size <= 0 then 0
          when source_heat_row.heat_size <= 2 then 1
          else 2
        end,
        v_requested_advancers
      ) then
        v_refs := array_append(v_refs, jsonb_build_object(
          'source_round', source_heat_row.round,
          'source_heat', source_heat_row.heat_number,
          'source_position', v_position
        ));
      end if;
    end loop;
  end loop;

  if coalesce(array_length(v_refs, 1), 0) = 0 then
    return;
  end if;

  if coalesce(array_length(v_refs, 1), 0) < v_total_current_slots then
    v_refs := array_append(v_refs, jsonb_build_object(
      'source_round', v_previous_round,
      'source_heat', null,
      'source_position', null,
      'best_second_round', v_previous_round
    ));
  end if;

  for v_ref_index in 1..array_length(v_refs, 1) loop
    v_ref := v_refs[v_ref_index];
    v_candidate_idx := v_idx;
    v_candidate_direction := v_direction;
    v_fallback_idx := null;
    v_fallback_direction := null;
    v_chosen_idx := null;
    v_chosen_direction := null;

    -- Walk the snake from the preferred cursor and choose the first open heat
    -- that does not already contain a qualifier from the same source heat.
    for v_guard in 1..greatest(1, v_heat_count * 2) loop
      if coalesce(v_counts[v_candidate_idx], 0) < coalesce(v_capacities[v_candidate_idx], 0) then
        if v_fallback_idx is null then
          v_fallback_idx := v_candidate_idx;
          v_fallback_direction := v_candidate_direction;
        end if;

        select exists (
          select 1
          from jsonb_array_elements(coalesce(v_assignments[v_candidate_idx], '[]'::jsonb)) existing(value)
          where (existing.value ->> 'source_heat') is not null
            and (v_ref ->> 'source_heat') is not null
            and (existing.value ->> 'source_round')::integer = (v_ref ->> 'source_round')::integer
            and (existing.value ->> 'source_heat')::integer = (v_ref ->> 'source_heat')::integer
        )
          into v_has_collision;

        if not coalesce(v_has_collision, false) then
          v_chosen_idx := v_candidate_idx;
          v_chosen_direction := v_candidate_direction;
          exit;
        end if;
      end if;

      if v_heat_count <= 1 then
        v_candidate_idx := 1;
        v_candidate_direction := 1;
      elsif v_candidate_direction = 1 then
        if v_candidate_idx = v_heat_count then
          v_candidate_direction := -1;
        else
          v_candidate_idx := v_candidate_idx + 1;
        end if;
      else
        if v_candidate_idx = 1 then
          v_candidate_direction := 1;
        else
          v_candidate_idx := v_candidate_idx - 1;
        end if;
      end if;
    end loop;

    if v_chosen_idx is null then
      v_chosen_idx := v_fallback_idx;
      v_chosen_direction := v_fallback_direction;
    end if;

    if v_chosen_idx is null or coalesce(v_capacities[v_chosen_idx], 0) <= 0 then
      continue;
    end if;

    v_assignments[v_chosen_idx] := coalesce(v_assignments[v_chosen_idx], '[]'::jsonb) || jsonb_build_array(v_ref);
    v_counts[v_chosen_idx] := coalesce(v_counts[v_chosen_idx], 0) + 1;

    if v_heat_count <= 1 then
      v_idx := 1;
      v_direction := 1;
    elsif v_chosen_direction = 1 then
      if v_chosen_idx = v_heat_count then
        v_idx := v_chosen_idx;
        v_direction := -1;
      else
        v_idx := v_chosen_idx + 1;
        v_direction := v_chosen_direction;
      end if;
    else
      if v_chosen_idx = 1 then
        v_idx := v_chosen_idx;
        v_direction := 1;
      else
        v_idx := v_chosen_idx - 1;
        v_direction := v_chosen_direction;
      end if;
    end if;
  end loop;

  v_target_index := array_position(v_heat_ids, trim(p_target_heat_id));
  if v_target_index is null then
    return;
  end if;

  for v_assignment in
    select value
    from jsonb_array_elements(coalesce(v_assignments[v_target_index], '[]'::jsonb))
  loop
    v_output_position := v_output_position + 1;
    heat_id := trim(p_target_heat_id);
    slot_position := v_output_position;
    if (v_assignment ->> 'best_second_round') is not null then
      source_round := null;
      source_heat := null;
      source_position := null;
      placeholder := format('Meilleur 2e R%s', (v_assignment ->> 'best_second_round')::integer);
    else
      source_round := (v_assignment ->> 'source_round')::integer;
      source_heat := (v_assignment ->> 'source_heat')::integer;
      source_position := (v_assignment ->> 'source_position')::integer;
      placeholder := format('R%s-H%s-P%s', source_round, source_heat, source_position);
    end if;
    return next;
  end loop;
end;
$$;

grant execute on function public.fn_infer_heat_slot_mappings_for_heat(text) to anon, authenticated, service_role;

commit;
