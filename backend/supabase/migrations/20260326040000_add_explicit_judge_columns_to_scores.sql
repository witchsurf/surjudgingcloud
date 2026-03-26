alter table public.scores
  add column if not exists judge_station text,
  add column if not exists judge_identity_id text;

alter table public.score_overrides
  add column if not exists judge_station text,
  add column if not exists judge_identity_id text;

alter table public.interference_calls
  add column if not exists judge_station text,
  add column if not exists judge_identity_id text;

update public.scores
set judge_station = coalesce(nullif(trim(judge_station), ''), trim(judge_id))
where judge_station is null
   or trim(judge_station) = '';

update public.score_overrides
set judge_station = coalesce(nullif(trim(judge_station), ''), trim(judge_id))
where judge_station is null
   or trim(judge_station) = '';

update public.interference_calls
set judge_station = coalesce(nullif(trim(judge_station), ''), trim(judge_id))
where judge_station is null
   or trim(judge_station) = '';

create index if not exists idx_scores_heat_station
  on public.scores(heat_id, judge_station);

create index if not exists idx_scores_judge_identity_id
  on public.scores(judge_identity_id);

create index if not exists idx_score_overrides_heat_station
  on public.score_overrides(heat_id, judge_station);

create index if not exists idx_score_overrides_judge_identity_id
  on public.score_overrides(judge_identity_id);

create index if not exists idx_interference_calls_heat_station
  on public.interference_calls(heat_id, judge_station);

create index if not exists idx_interference_calls_judge_identity_id
  on public.interference_calls(judge_identity_id);
