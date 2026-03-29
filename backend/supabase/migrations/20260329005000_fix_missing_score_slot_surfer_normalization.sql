create or replace function public.fn_normalize_jersey_label_sql(p_value text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case upper(trim(coalesce(p_value, '')))
    when 'RED' then 'ROUGE'
    when 'ROUGE' then 'ROUGE'
    when 'WHITE' then 'BLANC'
    when 'BLANC' then 'BLANC'
    when 'YELLOW' then 'JAUNE'
    when 'JAUNE' then 'JAUNE'
    when 'BLUE' then 'BLEU'
    when 'BLEU' then 'BLEU'
    when 'GREEN' then 'VERT'
    when 'VERT' then 'VERT'
    when 'BLACK' then 'NOIR'
    when 'NOIR' then 'NOIR'
    else upper(trim(coalesce(p_value, '')))
  end;
$$;

create or replace view public.v_heat_missing_score_slots as
with expected_judges as (
  select
    heat.id as heat_id,
    heat.event_id,
    upper(trim(station.value)) as judge_station,
    nullif(trim(assignment.judge_id), '') as judge_identity_id,
    coalesce(nullif(trim(assignment.judge_name), ''), upper(trim(station.value))) as judge_display_name
  from public.heats heat
  join public.heat_configs config
    on config.heat_id = heat.id
  cross join lateral jsonb_array_elements_text(
    coalesce(to_jsonb(config.judges), '[]'::jsonb)
  ) as station(value)
  left join public.heat_judge_assignments assignment
    on assignment.heat_id = heat.id
   and upper(trim(assignment.station)) = upper(trim(station.value))
),
started_wave_slots as (
  select distinct
    score.heat_id,
    score.event_id,
    public.fn_normalize_jersey_label_sql(score.surfer) as surfer,
    score.wave_number
  from public.v_scores_canonical_enriched score
  where score.score > 0
),
matched_scores as (
  select distinct
    score.heat_id,
    public.fn_normalize_jersey_label_sql(score.surfer) as surfer,
    score.wave_number,
    nullif(trim(score.judge_identity_id), '') as judge_identity_id,
    upper(trim(score.judge_station)) as judge_station
  from public.v_scores_canonical_enriched score
  where score.score > 0
)
select
  expected.event_id,
  expected.heat_id,
  expected.judge_station,
  expected.judge_identity_id,
  expected.judge_display_name,
  started.surfer,
  started.wave_number
from expected_judges expected
join started_wave_slots started
  on started.heat_id = expected.heat_id
left join matched_scores matched
  on matched.heat_id = started.heat_id
 and matched.surfer = started.surfer
 and matched.wave_number = started.wave_number
 and (
   (
     expected.judge_identity_id is not null
     and matched.judge_identity_id is not null
     and lower(matched.judge_identity_id) = lower(expected.judge_identity_id)
   )
   or matched.judge_station = expected.judge_station
 )
where matched.heat_id is null;

create or replace function public.fn_get_heat_close_validation(p_heat_id text)
returns table (
  heat_id text,
  event_id bigint,
  has_any_scores boolean,
  started_wave_count integer,
  missing_score_count integer,
  pending_slots jsonb
)
language sql
stable
set search_path to 'public'
as $$
  with normalized_heat as (
    select h.id as heat_id, h.event_id
    from public.heats h
    where h.id = p_heat_id
  ),
  started_waves as (
    select distinct
      score.heat_id,
      public.fn_normalize_jersey_label_sql(score.surfer) as surfer,
      score.wave_number
    from public.v_scores_canonical_enriched score
    where score.heat_id = p_heat_id
      and score.score > 0
  ),
  missing_slots as (
    select
      slot.heat_id,
      slot.event_id,
      slot.judge_station,
      slot.judge_identity_id,
      slot.judge_display_name,
      slot.surfer,
      slot.wave_number
    from public.v_heat_missing_score_slots slot
    where slot.heat_id = p_heat_id
  )
  select
    nh.heat_id,
    nh.event_id,
    exists (
      select 1
      from public.v_scores_canonical_enriched score
      where score.heat_id = nh.heat_id
        and score.score > 0
    ) as has_any_scores,
    coalesce((select count(*) from started_waves), 0)::integer as started_wave_count,
    coalesce((select count(*) from missing_slots), 0)::integer as missing_score_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'judge_station', slot.judge_station,
          'judge_identity_id', slot.judge_identity_id,
          'judge_display_name', slot.judge_display_name,
          'surfer', slot.surfer,
          'wave_number', slot.wave_number
        )
        order by slot.judge_display_name, slot.surfer, slot.wave_number
      )
      from missing_slots slot
    ), '[]'::jsonb) as pending_slots
  from normalized_heat nh;
$$;
