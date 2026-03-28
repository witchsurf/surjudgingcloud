alter table public.scores disable trigger trg_block_scores_update;
alter table public.scores disable trigger trg_block_scores_insert;

create or replace function public.fn_resolve_canonical_heat_id(
  p_heat_id text,
  p_competition text default null,
  p_division text default null,
  p_round integer default null
)
returns text
language plpgsql
as $$
declare
  source_heat record;
  canonical_heat_id text;
begin
  if p_heat_id is null or trim(p_heat_id) = '' then
    return p_heat_id;
  end if;

  select
    h.id,
    h.competition,
    h.division,
    h.round,
    h.heat_number
  into source_heat
  from public.heats h
  where h.id = p_heat_id;

  if found then
    select candidate.id
    into canonical_heat_id
    from public.heats candidate
    where lower(regexp_replace(coalesce(candidate.competition, ''), '[^a-z0-9]+', '', 'g')) =
          lower(regexp_replace(coalesce(source_heat.competition, ''), '[^a-z0-9]+', '', 'g'))
      and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(source_heat.division, '')))
      and candidate.round = source_heat.round
      and candidate.heat_number = source_heat.heat_number
    order by candidate.event_id desc, candidate.id desc
    limit 1;

    return coalesce(canonical_heat_id, p_heat_id);
  end if;

  if p_competition is not null and p_division is not null and p_round is not null then
    select candidate.id
    into canonical_heat_id
    from public.heats candidate
    where lower(regexp_replace(coalesce(candidate.competition, ''), '[^a-z0-9]+', '', 'g')) =
          lower(regexp_replace(coalesce(p_competition, ''), '[^a-z0-9]+', '', 'g'))
      and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(p_division, '')))
      and candidate.round = p_round
      and candidate.heat_number = nullif(substring(lower(p_heat_id) from '_h([0-9]+)$'), '')::integer
    order by candidate.event_id desc, candidate.id desc
    limit 1;
  end if;

  return coalesce(canonical_heat_id, p_heat_id);
end;
$$;

create or replace function public.fn_canonicalize_score_heat_id()
returns trigger
language plpgsql
as $$
begin
  new.heat_id := public.fn_resolve_canonical_heat_id(
    new.heat_id,
    new.competition,
    new.division,
    new.round
  );
  return new;
end;
$$;

drop trigger if exists trg_scores_canonicalize_heat_id on public.scores;

create trigger trg_scores_canonicalize_heat_id
  before insert or update of heat_id, competition, division, round
  on public.scores
  for each row
  execute function public.fn_canonicalize_score_heat_id();

update public.scores
set heat_id = public.fn_resolve_canonical_heat_id(heat_id, competition, division, round)
where heat_id is not null
  and heat_id <> public.fn_resolve_canonical_heat_id(heat_id, competition, division, round);

update public.score_overrides
set heat_id = public.fn_resolve_canonical_heat_id(heat_id, competition, division, round)
where heat_id is not null
  and heat_id <> public.fn_resolve_canonical_heat_id(heat_id, competition, division, round);

update public.interference_calls
set heat_id = public.fn_resolve_canonical_heat_id(heat_id, competition, division, round)
where heat_id is not null
  and heat_id <> public.fn_resolve_canonical_heat_id(heat_id, competition, division, round);

update public.scores s
set event_id = h.event_id
from public.heats h
where h.id = s.heat_id
  and h.event_id is not null
  and s.event_id is distinct from h.event_id;

alter table public.scores enable trigger trg_block_scores_insert;
alter table public.scores enable trigger trg_block_scores_update;
