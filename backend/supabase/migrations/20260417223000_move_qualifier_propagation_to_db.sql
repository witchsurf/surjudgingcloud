begin;

create or replace function public.fn_normalize_heat_color_sql(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(trim(coalesce(p_value, '')))
    when 'RED' then 'RED'
    when 'ROUGE' then 'RED'
    when 'WHITE' then 'WHITE'
    when 'BLANC' then 'WHITE'
    when 'YELLOW' then 'YELLOW'
    when 'JAUNE' then 'YELLOW'
    when 'BLUE' then 'BLUE'
    when 'BLEU' then 'BLUE'
    when 'GREEN' then 'GREEN'
    when 'VERT' then 'GREEN'
    when 'BLACK' then 'BLACK'
    when 'NOIR' then 'BLACK'
    else upper(trim(coalesce(p_value, '')))
  end;
$$;

create or replace function public.fn_heat_interference_summary(p_heat_id text)
returns table (
  surfer_color text,
  interference_count integer,
  interference_type text,
  is_disqualified boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with judge_count as (
    select greatest(
      count(
        distinct coalesce(
          nullif(trim(score.judge_identity_id), ''),
          upper(trim(coalesce(score.judge_station, score.judge_id)))
        )
      ),
      1
    )::int as judge_count
    from public.scores score
    where score.heat_id = trim(p_heat_id)
      and score.score > 0
  ),
  normalized_calls as (
    select
      public.fn_normalize_heat_color_sql(call.surfer) as surfer_color,
      call.wave_number,
      upper(trim(call.call_type)) as call_type,
      coalesce(call.is_head_judge_override, false) as is_head_judge_override,
      coalesce(nullif(trim(call.judge_identity_id), ''), upper(trim(coalesce(call.judge_station, call.judge_id)))) as judge_key,
      coalesce(call.updated_at, call.created_at, now()) as sort_ts
    from public.interference_calls call
    where call.heat_id = trim(p_heat_id)
      and call.wave_number is not null
      and nullif(trim(coalesce(call.surfer, '')), '') is not null
      and upper(trim(coalesce(call.call_type, ''))) in ('INT1', 'INT2')
  ),
  head_overrides as (
    select distinct on (surfer_color, wave_number)
      surfer_color,
      wave_number,
      call_type
    from normalized_calls
    where is_head_judge_override
    order by surfer_color, wave_number, sort_ts desc
  ),
  latest_by_judge as (
    select distinct on (surfer_color, wave_number, judge_key)
      surfer_color,
      wave_number,
      judge_key,
      call_type,
      sort_ts
    from normalized_calls
    order by surfer_color, wave_number, judge_key, sort_ts desc
  ),
  majorities as (
    select
      surfer_color,
      wave_number,
      count(*) filter (where call_type = 'INT1') as int1_count,
      count(*) filter (where call_type = 'INT2') as int2_count
    from latest_by_judge
    group by surfer_color, wave_number
  ),
  effective_per_wave as (
    select
      coalesce(override.surfer_color, majority.surfer_color) as surfer_color,
      coalesce(override.wave_number, majority.wave_number) as wave_number,
      case
        when override.call_type is not null then override.call_type
        when majority.int2_count >= (select floor(jc.judge_count / 2.0)::int + 1 from judge_count jc) then 'INT2'
        when majority.int1_count >= (select floor(jc.judge_count / 2.0)::int + 1 from judge_count jc) then 'INT1'
        else null
      end as effective_type
    from majorities majority
    full outer join head_overrides override
      on override.surfer_color = majority.surfer_color
     and override.wave_number = majority.wave_number
  )
  select
    effective.surfer_color,
    count(*)::int as interference_count,
    (array_agg(effective.effective_type order by effective.wave_number))[1] as interference_type,
    (count(*) >= 2) as is_disqualified
  from effective_per_wave effective
  where effective.effective_type is not null
  group by effective.surfer_color;
$$;

create or replace function public.fn_rank_heat_entries_from_scores(p_heat_id text)
returns table (
  rank_pos integer,
  participant_id bigint,
  seed integer,
  color text,
  best_two numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with judge_count as (
    select greatest(
      count(
        distinct coalesce(
          nullif(trim(score.judge_identity_id), ''),
          upper(trim(coalesce(score.judge_station, score.judge_id)))
        )
      ),
      1
    )::int as judge_count
    from public.scores score
    where score.heat_id = trim(p_heat_id)
      and score.score > 0
  ),
  latest_scores as (
    select
      score.heat_id,
      public.fn_normalize_heat_color_sql(score.surfer) as surfer_color,
      coalesce(
        nullif(trim(score.judge_identity_id), ''),
        upper(trim(coalesce(score.judge_station, score.judge_id)))
      ) as judge_key,
      score.wave_number,
      score.score,
      row_number() over (
        partition by
          score.heat_id,
          public.fn_normalize_heat_color_sql(score.surfer),
          score.wave_number,
          coalesce(
            nullif(trim(score.judge_identity_id), ''),
            upper(trim(coalesce(score.judge_station, score.judge_id)))
          )
        order by
          coalesce(score.timestamp, score.created_at) desc,
          score.created_at desc,
          score.id desc
      ) as row_rank
    from public.scores score
    where score.heat_id = trim(p_heat_id)
      and score.score > 0
  ),
  wave_scores as (
    select
      latest_scores.heat_id,
      latest_scores.surfer_color,
      latest_scores.wave_number,
      round(
        case
          when (select jc.judge_count from judge_count jc) >= 5
           and count(*) >= (select jc.judge_count from judge_count jc)
            then ((sum(latest_scores.score) - min(latest_scores.score) - max(latest_scores.score)) / greatest(count(*) - 2, 1))::numeric
          else avg(latest_scores.score)::numeric
        end,
        2
      ) as wave_avg
    from latest_scores
    where latest_scores.row_rank = 1
      and latest_scores.judge_key is not null
      and latest_scores.judge_key <> ''
    group by latest_scores.heat_id, latest_scores.surfer_color, latest_scores.wave_number
  ),
  ranked_waves as (
    select
      wave_scores.*,
      row_number() over (
        partition by wave_scores.heat_id, wave_scores.surfer_color
        order by wave_scores.wave_avg desc, wave_scores.wave_number asc
      ) as wave_rank
    from wave_scores
  ),
  best_two_raw as (
    select
      ranked_waves.heat_id,
      ranked_waves.surfer_color,
      round(sum(ranked_waves.wave_avg)::numeric, 2) as best_two_raw
    from ranked_waves
    where ranked_waves.wave_rank <= 2
    group by ranked_waves.heat_id, ranked_waves.surfer_color
  ),
  best_wave as (
    select
      ranked_waves.heat_id,
      ranked_waves.surfer_color,
      max(ranked_waves.wave_avg) as best_wave_avg
    from ranked_waves
    group by ranked_waves.heat_id, ranked_waves.surfer_color
  ),
  adjusted_scores as (
    select
      raw.heat_id,
      raw.surfer_color,
      case
        when coalesce(summary.is_disqualified, false) then 0::numeric
        when summary.interference_type = 'INT1' then round((raw.best_two_raw - (coalesce(second_wave.wave_avg, 0) / 2.0))::numeric, 2)
        when summary.interference_type = 'INT2' then round(coalesce(best.best_wave_avg, 0)::numeric, 2)
        else raw.best_two_raw
      end as best_two
    from best_two_raw raw
    left join public.fn_heat_interference_summary(trim(p_heat_id)) summary
      on summary.surfer_color = raw.surfer_color
    left join ranked_waves second_wave
      on second_wave.heat_id = raw.heat_id
     and second_wave.surfer_color = raw.surfer_color
     and second_wave.wave_rank = 2
    left join best_wave best
      on best.heat_id = raw.heat_id
     and best.surfer_color = raw.surfer_color
  ),
  ranked_scores as (
    select
      adjusted.heat_id,
      adjusted.surfer_color,
      adjusted.best_two,
      dense_rank() over (
        partition by adjusted.heat_id
        order by adjusted.best_two desc, adjusted.surfer_color asc
      ) as rank_pos
    from adjusted_scores adjusted
  )
  select
    ranked.rank_pos,
    entry.participant_id,
    entry.seed,
    entry.color,
    ranked.best_two
  from ranked_scores ranked
  join public.heat_entries entry
    on entry.heat_id = ranked.heat_id
   and public.fn_normalize_heat_color_sql(entry.color) = ranked.surfer_color
  where entry.participant_id is not null;
$$;

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

  for source_heat_row in
    select h.round, h.heat_number, coalesce(h.heat_size, 0) as heat_size
    from public.heats h
    where h.event_id = v_target.event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
      and h.round = v_previous_round
    order by h.heat_number asc
  loop
    for v_ref_index in 1..least(
      case
        when source_heat_row.heat_size <= 0 then 0
        when source_heat_row.heat_size <= 2 then 1
        else 2
      end,
      v_requested_advancers
    ) loop
      v_refs := array_append(v_refs, jsonb_build_object(
        'source_round', source_heat_row.round,
        'source_heat', source_heat_row.heat_number,
        'source_position', v_ref_index
      ));
    end loop;
  end loop;

  if coalesce(array_length(v_refs, 1), 0) = 0 then
    return;
  end if;

  for v_ref_index in 1..array_length(v_refs, 1) loop
    v_ref := v_refs[v_ref_index];
    v_guard := 0;

    while coalesce(v_counts[v_idx], 0) >= coalesce(v_capacities[v_idx], 0) and v_guard < v_heat_count * 2 loop
      if v_heat_count <= 1 then
        v_idx := 1;
        v_direction := 1;
      elsif v_direction = 1 then
        if v_idx = v_heat_count then
          v_direction := -1;
        else
          v_idx := v_idx + 1;
        end if;
      else
        if v_idx = 1 then
          v_direction := 1;
        else
          v_idx := v_idx - 1;
        end if;
      end if;
      v_guard := v_guard + 1;
    end loop;

    if coalesce(v_capacities[v_idx], 0) <= 0 then
      continue;
    end if;

    v_assignments[v_idx] := coalesce(v_assignments[v_idx], '[]'::jsonb) || jsonb_build_array(v_ref);
    v_counts[v_idx] := coalesce(v_counts[v_idx], 0) + 1;

    if v_heat_count <= 1 then
      v_idx := 1;
      v_direction := 1;
    elsif v_direction = 1 then
      if v_idx = v_heat_count then
        v_direction := -1;
      else
        v_idx := v_idx + 1;
      end if;
    else
      if v_idx = 1 then
        v_direction := 1;
      else
        v_idx := v_idx - 1;
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
    source_round := (v_assignment ->> 'source_round')::integer;
    source_heat := (v_assignment ->> 'source_heat')::integer;
    source_position := (v_assignment ->> 'source_position')::integer;
    placeholder := format('R%s-H%s-P%s', source_round, source_heat, source_position);
    return next;
  end loop;
end;
$$;

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
  v_ranked_participant_id bigint;
  v_ranked_seed integer;
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

    for v_mapping in
      with resolved_mappings as (
        select
          hm.heat_id,
          hm.position,
          coalesce(
            hm.source_round,
            (
              case
                when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+' then
                  (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[2]::integer
                else null
              end
            )
          ) as resolved_source_round,
          coalesce(
            hm.source_heat,
            (
              case
                when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+' then
                  (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[3]::integer
                else null
              end
            )
          ) as resolved_source_heat,
          coalesce(
            hm.source_position,
            (
              case
                when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+' then
                  (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[4]::integer
                else null
              end
            )
          ) as resolved_source_position
        from public.heat_slot_mappings hm
        where hm.heat_id = v_target.id
      )
      select
        resolved_mappings.heat_id,
        resolved_mappings.position,
        resolved_mappings.resolved_source_position as source_position
      from resolved_mappings
      where resolved_mappings.resolved_source_round = v_source.round
        and resolved_mappings.resolved_source_heat = v_source.heat_number
      order by resolved_mappings.position asc
    loop
      v_ranked_participant_id := null;
      v_ranked_seed := null;

      select ranked.participant_id, ranked.seed
        into v_ranked_participant_id, v_ranked_seed
      from public.fn_rank_heat_entries_from_scores(v_source.id) ranked
      where ranked.rank_pos = v_mapping.source_position
      limit 1;

      insert into public.heat_entries (heat_id, participant_id, position, seed, color)
      values (
        v_target.id,
        v_ranked_participant_id,
        v_mapping.position,
        coalesce(v_ranked_seed, v_mapping.position),
        coalesce(v_target.color_order[v_mapping.position], case v_mapping.position
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
  end loop;

  return v_updated;
end;
$$;

create or replace function public.rebuild_division_qualifiers_from_scores(p_event_id bigint, p_division text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heat record;
  v_total integer := 0;
begin
  for v_heat in
    select h.id
    from public.heats h
    where h.event_id = p_event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(p_division, '')))
      and exists (
        select 1
        from public.scores score
        where score.heat_id = h.id
          and score.score > 0
      )
    order by h.round asc, h.heat_number asc
  loop
    v_total := v_total + public.fn_propagate_qualifiers_for_source_heat(v_heat.id);
  end loop;

  return v_total;
end;
$$;

grant execute on function public.fn_heat_interference_summary(text) to anon, authenticated, service_role;
grant execute on function public.fn_rank_heat_entries_from_scores(text) to anon, authenticated, service_role;
grant execute on function public.fn_infer_heat_slot_mappings_for_heat(text) to anon, authenticated, service_role;
grant execute on function public.fn_propagate_qualifiers_for_source_heat(text) to anon, authenticated, service_role;
grant execute on function public.rebuild_division_qualifiers_from_scores(bigint, text) to anon, authenticated, service_role;

create or replace function public.fn_unified_heat_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event_id bigint;
  v_event_name text;
  v_division text;
  v_round integer;
  v_heat_no integer;
  v_next_heat_id text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status <> 'closed' then
    return new;
  end if;

  if coalesce(old.status, '') = new.status then
    return new;
  end if;

  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;

  select h.event_id, h.competition, h.division, h.round, h.heat_number
    into v_event_id, v_event_name, v_division, v_round, v_heat_no
    from public.heats h
   where h.id = new.heat_id
     for update nowait;

  if not found then
    return new;
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now())
   where id = new.heat_id
     and status <> 'closed';

  perform public.fn_propagate_qualifiers_for_source_heat(new.heat_id);

  select h.id
    into v_next_heat_id
    from public.heats h
   where h.event_id = v_event_id
     and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_division, '')))
     and h.id <> new.heat_id
     and h.status in ('waiting', 'open')
     and (
       (h.round = v_round and h.heat_number > v_heat_no)
       or (h.round > v_round)
     )
   order by h.round asc, h.heat_number asc
   limit 1
     for update skip locked;

  if v_next_heat_id is not null then
    insert into public.heat_realtime_config (
      heat_id,
      status,
      timer_start_time,
      updated_at,
      updated_by
    )
    values (
      v_next_heat_id,
      'waiting',
      null,
      now(),
      coalesce(new.updated_by, 'system')
    )
    on conflict (heat_id)
    do update set
      status = 'waiting',
      timer_start_time = null,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    update public.heats
       set status = 'open'
     where id = v_next_heat_id
       and status in ('waiting', 'open');

    insert into public.active_heat_pointer (
      event_id,
      event_name,
      active_heat_id,
      updated_at
    )
    values (
      v_event_id,
      v_event_name,
      v_next_heat_id,
      now()
    )
    on conflict (event_id)
    do update set
      event_name = excluded.event_name,
      active_heat_id = excluded.active_heat_id,
      updated_at = excluded.updated_at;
  end if;

  return new;
exception
  when lock_not_available then
    raise notice 'Heat transition skipped (locked): %', new.heat_id;
    return new;
  when others then
    raise warning 'Error in heat transition for %: %', new.heat_id, sqlerrm;
    return new;
end;
$$;

create or replace function public.fn_advance_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id bigint;
  v_event_name text;
  v_division text;
  v_round integer;
  v_heat_no integer;
  v_next_id text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status <> 'closed' then
    return new;
  end if;

  if coalesce(old.status, '') = new.status then
    return new;
  end if;

  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now())
   where id = new.heat_id
     and status <> 'closed';

  perform public.fn_propagate_qualifiers_for_source_heat(new.heat_id);

  select h.event_id, h.competition, h.division, h.round, h.heat_number
    into v_event_id, v_event_name, v_division, v_round, v_heat_no
    from public.heats h
   where h.id = new.heat_id
   limit 1;

  select h.id
    into v_next_id
    from public.heats h
   where h.event_id = v_event_id
     and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_division, '')))
     and h.id <> new.heat_id
     and h.status in ('waiting', 'open')
     and (
       (h.round = v_round and h.heat_number > v_heat_no)
       or (h.round > v_round)
     )
   order by h.round asc, h.heat_number asc
   limit 1;

  if v_next_id is not null then
    insert into public.heat_realtime_config (
      heat_id,
      status,
      timer_start_time,
      updated_at,
      updated_by
    )
    values (
      v_next_id,
      'waiting',
      null,
      now(),
      coalesce(new.updated_by, current_user)
    )
    on conflict (heat_id)
    do update set
      status = 'waiting',
      timer_start_time = null,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    update public.heats
       set status = 'open'
     where id = v_next_id
       and status in ('waiting', 'open');

    insert into public.active_heat_pointer (
      event_id,
      event_name,
      active_heat_id,
      updated_at
    )
    values (
      v_event_id,
      v_event_name,
      v_next_id,
      now()
    )
    on conflict (event_id)
    do update set
      event_name = excluded.event_name,
      active_heat_id = excluded.active_heat_id,
      updated_at = excluded.updated_at;
  end if;

  return new;
end;
$$;

commit;
