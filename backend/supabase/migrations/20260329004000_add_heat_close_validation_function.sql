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
      upper(trim(score.surfer)) as surfer,
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
