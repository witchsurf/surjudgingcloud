alter table public.scores disable trigger trg_block_scores_update;
alter table public.scores disable trigger trg_block_scores_insert;

update public.scores s
set event_id = h.event_id
from public.heats h
where h.id = s.heat_id
  and h.event_id is not null
  and s.event_id is distinct from h.event_id;

create or replace function public.fn_sync_scores_event_id_from_heat()
returns trigger
language plpgsql
as $$
begin
  if new.heat_id is not null then
    select h.event_id
      into new.event_id
    from public.heats h
    where h.id = new.heat_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_scores_sync_event_id on public.scores;

create trigger trg_scores_sync_event_id
  before insert or update of heat_id, event_id
  on public.scores
  for each row
  execute function public.fn_sync_scores_event_id_from_heat();

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
    coalesce(heat.event_id, ranked_scores.event_id) as event_id,
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

alter table public.scores enable trigger trg_block_scores_insert;
alter table public.scores enable trigger trg_block_scores_update;
