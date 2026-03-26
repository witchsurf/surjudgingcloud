create or replace view public.v_scores_canonical_enriched as
with ranked_scores as (
  select
    score.*,
    upper(trim(coalesce(score.judge_station, score.judge_id))) as judge_station_normalized,
    row_number() over (
      partition by
        score.heat_id,
        upper(trim(coalesce(score.judge_station, score.judge_id))),
        upper(trim(score.surfer)),
        score.wave_number
      order by
        coalesce(score.timestamp, score.created_at) desc,
        score.created_at desc,
        score.id desc
    ) as row_rank
  from public.scores score
),
resolved_scores as (
  select
    ranked_scores.id,
    coalesce(ranked_scores.event_id, heat.event_id) as event_id,
    ranked_scores.heat_id,
    ranked_scores.competition,
    ranked_scores.division,
    ranked_scores.round,
    coalesce(nullif(trim(ranked_scores.judge_identity_id), ''), assignment.judge_id, ranked_scores.judge_id) as judge_identity_id,
    ranked_scores.judge_station_normalized as judge_station,
    coalesce(nullif(trim(ranked_scores.judge_name), ''), assignment.judge_name, ranked_scores.judge_id) as judge_display_name,
    ranked_scores.surfer,
    ranked_scores.wave_number,
    ranked_scores.score,
    ranked_scores.timestamp,
    ranked_scores.created_at
  from ranked_scores
  left join public.heats heat
    on heat.id = ranked_scores.heat_id
  left join public.heat_judge_assignments assignment
    on assignment.heat_id = ranked_scores.heat_id
   and upper(trim(assignment.station)) = ranked_scores.judge_station_normalized
  where ranked_scores.row_rank = 1
)
select * from resolved_scores;

create or replace view public.v_event_judge_assignment_coverage as
with expected_stations as (
  select
    heat.id as heat_id,
    heat.event_id,
    heat.competition,
    heat.division,
    heat.round,
    heat.heat_number,
    upper(trim(station.value)) as station
  from public.heats heat
  join public.heat_configs config
    on config.heat_id = heat.id
  cross join lateral jsonb_array_elements_text(
    coalesce(to_jsonb(config.judges), '[]'::jsonb)
  ) as station(value)
),
resolved_assignments as (
  select
    assignment.heat_id,
    upper(trim(assignment.station)) as station,
    nullif(trim(assignment.judge_id), '') as judge_identity_id,
    nullif(trim(assignment.judge_name), '') as judge_name
  from public.heat_judge_assignments assignment
)
select
  expected.event_id,
  expected.competition,
  expected.division,
  expected.round,
  expected.heat_number,
  expected.heat_id,
  count(*)::integer as expected_station_count,
  count(*) filter (
    where assignment.judge_identity_id is not null
      and assignment.judge_name is not null
  )::integer as assigned_station_count,
  count(*) filter (
    where assignment.judge_identity_id is null
       or assignment.judge_name is null
  )::integer as missing_station_count,
  bool_and(
    assignment.judge_identity_id is not null
    and assignment.judge_name is not null
  ) as is_complete
from expected_stations expected
left join resolved_assignments assignment
  on assignment.heat_id = expected.heat_id
 and assignment.station = expected.station
group by
  expected.event_id,
  expected.competition,
  expected.division,
  expected.round,
  expected.heat_number,
  expected.heat_id;
