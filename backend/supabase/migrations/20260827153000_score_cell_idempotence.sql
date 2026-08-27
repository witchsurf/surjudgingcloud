begin;

-- Preserve every historical row. Existing Cloud data may contain legacy
-- duplicates whose provenance must be audited separately. The normalized
-- lookup index and serialized trigger below prevent any new duplicate fact
-- without deleting or rewriting old competition records.
create index if not exists scores_station_lycra_wave_lookup_idx
  on public.scores (
    heat_id,
    upper(trim(judge_station)),
    upper(trim(surfer)),
    wave_number
  );

create or replace function public.enforce_single_score_cell()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_existing record;
  v_incoming_time timestamptz := coalesce(new.timestamp, new.created_at, now());
begin
  perform pg_advisory_xact_lock(hashtextextended(format(
    'score-cell:%s:%s:%s:%s',
    new.heat_id,
    upper(trim(new.judge_station)),
    upper(trim(new.surfer)),
    new.wave_number
  ), 0));

  select id, timestamp, created_at, score
    into v_existing
  from public.scores
  where heat_id = new.heat_id
    and upper(trim(judge_station)) = upper(trim(new.judge_station))
    and upper(trim(surfer)) = upper(trim(new.surfer))
    and wave_number = new.wave_number
  order by coalesce(timestamp, created_at) desc nulls last, created_at desc nulls last, id desc
  limit 1
  for update;

  -- A replay after a lost acknowledgement may arrive after the chief judge
  -- has closed the heat. If the durable fact is already identical, acknowledge
  -- it as a no-op without firing the closed-heat UPDATE guard.
  if found
     and v_incoming_time = coalesce(v_existing.timestamp, v_existing.created_at)
     and new.score is not distinct from v_existing.score then
    return null;
  end if;

  if found and v_existing.id is distinct from new.id then
    if v_incoming_time >= coalesce(v_existing.timestamp, v_existing.created_at, '-infinity'::timestamptz) then
      update public.scores
         set event_id = new.event_id,
             competition = new.competition,
             division = new.division,
             round = new.round,
             judge_id = new.judge_id,
             judge_name = new.judge_name,
             judge_station = new.judge_station,
             judge_identity_id = new.judge_identity_id,
             surfer = new.surfer,
             wave_number = new.wave_number,
             score = new.score,
             timestamp = new.timestamp,
             created_at = least(coalesce(created_at, new.created_at), coalesce(new.created_at, created_at))
       where id = v_existing.id;
    end if;

    -- The existing stable identity wins. Returning NULL makes the attempted
    -- insert a successful no-op/update instead of creating a duplicate row.
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists scores_single_cell_before_insert on public.scores;
create trigger scores_single_cell_before_insert
before insert on public.scores
for each row execute function public.enforce_single_score_cell();

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260827153000_score_cell_idempotence',
  'Idempotent score cell persistence',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
