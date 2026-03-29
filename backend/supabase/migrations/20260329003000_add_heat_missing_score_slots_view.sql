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
    upper(trim(score.surfer)) as surfer,
    score.wave_number
  from public.v_scores_canonical_enriched score
  where score.score > 0
),
matched_scores as (
  select distinct
    score.heat_id,
    upper(trim(score.surfer)) as surfer,
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
