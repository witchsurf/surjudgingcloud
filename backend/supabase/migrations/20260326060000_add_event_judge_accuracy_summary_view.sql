create or replace view public.v_event_judge_accuracy_summary as
with canonical_scores as (
  select
    score.event_id,
    score.heat_id,
    score.judge_identity_id,
    score.judge_display_name,
    upper(trim(score.surfer)) as surfer_key,
    score.wave_number,
    score.score
  from public.v_scores_canonical_enriched score
  where nullif(trim(score.judge_identity_id), '') is not null
),
scored_waves as (
  select
    score.event_id,
    score.judge_identity_id,
    max(score.judge_display_name) as judge_display_name,
    count(*)::integer as scored_waves
  from canonical_scores score
  group by score.event_id, score.judge_identity_id
),
wave_consensus as (
  select
    score.event_id,
    score.judge_identity_id,
    score.judge_display_name,
    score.score,
    (
      select percentile_cont(0.5) within group (order by peer.score)
      from canonical_scores peer
      where peer.event_id = score.event_id
        and peer.heat_id = score.heat_id
        and peer.surfer_key = score.surfer_key
        and peer.wave_number = score.wave_number
        and peer.judge_identity_id <> score.judge_identity_id
    ) as consensus_score
  from canonical_scores score
),
score_accuracy as (
  select
    wave.event_id,
    wave.judge_identity_id,
    max(wave.judge_display_name) as judge_display_name,
    count(*) filter (where wave.consensus_score is not null)::integer as consensus_samples,
    round(
      coalesce(avg(abs(wave.score - wave.consensus_score)) filter (where wave.consensus_score is not null), 0)::numeric,
      2
    ) as mean_abs_deviation,
    round(
      coalesce(avg(wave.score - wave.consensus_score) filter (where wave.consensus_score is not null), 0)::numeric,
      2
    ) as bias,
    round(
      coalesce(
        avg(
          case
            when wave.consensus_score is null then null
            when abs(wave.score - wave.consensus_score) <= 0.5 then 100.0
            else 0.0
          end
        ),
        0
      )::numeric,
      2
    ) as within_half_point_rate
  from wave_consensus wave
  group by wave.event_id, wave.judge_identity_id
),
override_stats as (
  select
    coalesce(override_log.event_id, heat.event_id) as event_id,
    coalesce(
      nullif(trim(override_log.judge_identity_id), ''),
      assignment.judge_id,
      nullif(trim(override_log.judge_id), '')
    ) as judge_identity_id,
    max(
      coalesce(
        nullif(trim(override_log.judge_name), ''),
        assignment.judge_name,
        nullif(trim(override_log.judge_id), '')
      )
    ) as judge_display_name,
    count(*)::integer as override_count,
    round(
      coalesce(avg(abs(coalesce(override_log.new_score, 0) - coalesce(override_log.previous_score, 0))), 0)::numeric,
      2
    ) as average_override_delta
  from public.score_overrides override_log
  left join public.heats heat
    on heat.id = override_log.heat_id
  left join public.heat_judge_assignments assignment
    on assignment.heat_id = override_log.heat_id
   and upper(trim(assignment.station)) = upper(trim(coalesce(override_log.judge_station, override_log.judge_id)))
  where coalesce(
    nullif(trim(override_log.judge_identity_id), ''),
    assignment.judge_id,
    nullif(trim(override_log.judge_id), '')
  ) is not null
  group by
    coalesce(override_log.event_id, heat.event_id),
    coalesce(
      nullif(trim(override_log.judge_identity_id), ''),
      assignment.judge_id,
      nullif(trim(override_log.judge_id), '')
    )
),
combined as (
  select
    coalesce(score_stats.event_id, override_stats.event_id) as event_id,
    coalesce(score_stats.judge_identity_id, override_stats.judge_identity_id) as judge_identity_id,
    coalesce(score_stats.judge_display_name, override_stats.judge_display_name, coalesce(score_stats.judge_identity_id, override_stats.judge_identity_id)) as judge_display_name,
    coalesce(scored.scored_waves, 0) as scored_waves,
    coalesce(score_stats.consensus_samples, 0) as consensus_samples,
    coalesce(score_stats.mean_abs_deviation, 0) as mean_abs_deviation,
    coalesce(score_stats.bias, 0) as bias,
    coalesce(score_stats.within_half_point_rate, 0) as within_half_point_rate,
    coalesce(override_stats.override_count, 0) as override_count,
    coalesce(
      round(
        case
          when coalesce(scored.scored_waves, 0) > 0
            then (coalesce(override_stats.override_count, 0)::numeric / scored.scored_waves::numeric) * 100
          else 0
        end,
        2
      ),
      0
    ) as override_rate,
    coalesce(override_stats.average_override_delta, 0) as average_override_delta
  from score_accuracy score_stats
  full outer join override_stats
    on override_stats.event_id = score_stats.event_id
   and override_stats.judge_identity_id = score_stats.judge_identity_id
  left join scored_waves scored
    on scored.event_id = coalesce(score_stats.event_id, override_stats.event_id)
   and scored.judge_identity_id = coalesce(score_stats.judge_identity_id, override_stats.judge_identity_id)
)
select
  combined.*,
  round(
    greatest(
      0,
      least(
        100,
        100
        - least(45, combined.mean_abs_deviation * 30)
        - least(15, abs(combined.bias) * 20)
        - least(20, combined.override_rate * 0.5)
        + least(10, combined.within_half_point_rate * 0.1)
      )
    )::numeric,
    2
  ) as quality_score,
  case
    when greatest(
      0,
      least(
        100,
        100
        - least(45, combined.mean_abs_deviation * 30)
        - least(15, abs(combined.bias) * 20)
        - least(20, combined.override_rate * 0.5)
        + least(10, combined.within_half_point_rate * 0.1)
      )
    ) >= 85 then 'excellent'
    when greatest(
      0,
      least(
        100,
        100
        - least(45, combined.mean_abs_deviation * 30)
        - least(15, abs(combined.bias) * 20)
        - least(20, combined.override_rate * 0.5)
        + least(10, combined.within_half_point_rate * 0.1)
      )
    ) >= 70 then 'good'
    when greatest(
      0,
      least(
        100,
        100
        - least(45, combined.mean_abs_deviation * 30)
        - least(15, abs(combined.bias) * 20)
        - least(20, combined.override_rate * 0.5)
        + least(10, combined.within_half_point_rate * 0.1)
      )
    ) >= 55 then 'watch'
    else 'needs_review'
  end as quality_band
from combined;
