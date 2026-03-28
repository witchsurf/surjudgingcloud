alter table public.scores disable trigger trg_block_scores_update;
alter table public.scores disable trigger trg_block_scores_insert;

create or replace function public.fn_resolve_canonical_heat_id(
  p_heat_id text,
  p_event_id bigint default null,
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
  target_event_id bigint;
  target_competition text;
  target_division text;
  target_round integer;
  target_heat_number integer;
begin
  if p_heat_id is null or trim(p_heat_id) = '' then
    return p_heat_id;
  end if;

  select
    h.id,
    h.event_id,
    h.competition,
    h.division,
    h.round,
    h.heat_number
  into source_heat
  from public.heats h
  where h.id = p_heat_id;

  target_event_id := coalesce(p_event_id, source_heat.event_id);
  target_competition := coalesce(nullif(trim(p_competition), ''), source_heat.competition);
  target_division := coalesce(nullif(trim(p_division), ''), source_heat.division);
  target_round := coalesce(p_round, source_heat.round);
  target_heat_number := coalesce(
    source_heat.heat_number,
    nullif(substring(lower(p_heat_id) from '_h([0-9]+)$'), '')::integer
  );

  if found then
    select candidate.id
    into canonical_heat_id
    from public.heats candidate
    where (
        target_event_id is not null
        and candidate.event_id = target_event_id
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
      or (
        target_event_id is null
        and lower(regexp_replace(coalesce(candidate.competition, ''), '[^a-z0-9]+', '', 'g')) =
            lower(regexp_replace(coalesce(target_competition, ''), '[^a-z0-9]+', '', 'g'))
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
    order by candidate.event_id desc, candidate.id desc
    limit 1;

    return coalesce(canonical_heat_id, p_heat_id);
  end if;

  if target_division is not null and target_round is not null and target_heat_number is not null then
    select candidate.id
    into canonical_heat_id
    from public.heats candidate
    where (
        target_event_id is not null
        and candidate.event_id = target_event_id
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
      or (
        target_event_id is null
        and target_competition is not null
        and lower(regexp_replace(coalesce(candidate.competition, ''), '[^a-z0-9]+', '', 'g')) =
            lower(regexp_replace(coalesce(target_competition, ''), '[^a-z0-9]+', '', 'g'))
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
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
    new.event_id,
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
set heat_id = public.fn_resolve_canonical_heat_id(heat_id, event_id, competition, division, round)
where heat_id is not null
  and heat_id <> public.fn_resolve_canonical_heat_id(heat_id, event_id, competition, division, round);

update public.score_overrides
set heat_id = public.fn_resolve_canonical_heat_id(heat_id)
where heat_id is not null
  and heat_id <> public.fn_resolve_canonical_heat_id(heat_id);

update public.interference_calls
set heat_id = public.fn_resolve_canonical_heat_id(heat_id, event_id, competition, division, round)
where heat_id is not null
  and heat_id <> public.fn_resolve_canonical_heat_id(heat_id, event_id, competition, division, round);

update public.scores s
set event_id = h.event_id
from public.heats h
where h.id = s.heat_id
  and h.event_id is not null
  and s.event_id is distinct from h.event_id;

alter table public.scores enable trigger trg_block_scores_insert;
alter table public.scores enable trigger trg_block_scores_update;
