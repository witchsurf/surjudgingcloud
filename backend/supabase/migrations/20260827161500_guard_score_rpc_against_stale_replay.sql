begin;

-- Lost acknowledgements deliberately replay the original score UUID. If a
-- newer correction has already updated that stable row, the replay must be an
-- acknowledged no-op instead of restoring the older value.
create or replace function public.upsert_score_secure(
  p_id uuid,
  p_event_id bigint default null,
  p_heat_id text default null,
  p_competition text default null,
  p_division text default null,
  p_round integer default null,
  p_judge_id text default null,
  p_judge_name text default null,
  p_judge_station text default null,
  p_judge_identity_id text default null,
  p_surfer text default null,
  p_wave_number integer default null,
  p_score numeric default null,
  p_timestamp timestamptz default now(),
  p_created_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heat record;
  v_assignment record;
  v_heat_config record;
  v_station text := upper(trim(coalesce(p_judge_station, p_judge_id, '')));
  v_identity text := upper(trim(coalesce(p_judge_identity_id, p_judge_id, '')));
  v_allowed boolean := false;
  v_result jsonb;
begin
  if p_id is null then
    raise exception 'score id is required';
  end if;

  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'heat_id is required';
  end if;

  if v_station = '' then
    raise exception 'judge station is required';
  end if;

  if nullif(trim(coalesce(p_surfer, '')), '') is null then
    raise exception 'surfer is required';
  end if;

  if p_wave_number is null or p_wave_number <= 0 then
    raise exception 'wave_number must be positive';
  end if;

  if p_score is null then
    raise exception 'score is required';
  end if;

  select h.id, h.event_id, h.competition, h.division, h.round
    into v_heat
  from public.heats h
  where h.id = trim(p_heat_id);

  if not found then
    raise exception 'heat % not found', p_heat_id;
  end if;

  select station, judge_id, judge_name
    into v_assignment
  from public.heat_judge_assignments
  where heat_id = v_heat.id
    and upper(trim(station)) = v_station
  limit 1;

  if found then
    v_allowed := true;

    if nullif(trim(coalesce(v_assignment.judge_id, '')), '') is not null
       and upper(trim(v_assignment.judge_id)) <> upper(trim(v_assignment.station))
       and v_identity <> ''
       and upper(trim(v_assignment.judge_id)) <> v_identity then
      raise exception 'judge identity mismatch for station %', v_station;
    end if;
  else
    select judges
      into v_heat_config
    from public.heat_configs
    where heat_id = v_heat.id
    limit 1;

    if found and exists (
      select 1
      from unnest(coalesce(v_heat_config.judges, '{}'::text[])) as station_name
      where upper(trim(station_name)) = v_station
    ) then
      v_allowed := true;
    end if;
  end if;

  if not v_allowed then
    raise exception 'judge station % is not assigned to heat %', v_station, v_heat.id;
  end if;

  insert into public.scores (
    id,
    event_id,
    heat_id,
    competition,
    division,
    round,
    judge_id,
    judge_name,
    judge_station,
    judge_identity_id,
    surfer,
    wave_number,
    score,
    timestamp,
    created_at
  )
  values (
    p_id,
    coalesce(p_event_id, v_heat.event_id),
    v_heat.id,
    coalesce(nullif(trim(coalesce(p_competition, '')), ''), v_heat.competition, 'Competition'),
    coalesce(nullif(trim(coalesce(p_division, '')), ''), v_heat.division, 'OPEN'),
    coalesce(p_round, v_heat.round, 1),
    coalesce(nullif(trim(coalesce(p_judge_id, '')), ''), v_station),
    coalesce(
      nullif(trim(coalesce(p_judge_name, '')), ''),
      nullif(trim(coalesce(v_assignment.judge_name, '')), ''),
      v_station
    ),
    v_station,
    nullif(trim(coalesce(p_judge_identity_id, '')), ''),
    trim(p_surfer),
    p_wave_number,
    p_score,
    coalesce(p_timestamp, now()),
    coalesce(p_created_at, now())
  )
  on conflict (id) do update
    set event_id = excluded.event_id,
        heat_id = excluded.heat_id,
        competition = excluded.competition,
        division = excluded.division,
        round = excluded.round,
        judge_id = excluded.judge_id,
        judge_name = excluded.judge_name,
        judge_station = excluded.judge_station,
        judge_identity_id = excluded.judge_identity_id,
        surfer = excluded.surfer,
        wave_number = excluded.wave_number,
        score = excluded.score,
        timestamp = excluded.timestamp,
        created_at = least(coalesce(scores.created_at, excluded.created_at), coalesce(excluded.created_at, scores.created_at))
    where coalesce(excluded.timestamp, excluded.created_at, '-infinity'::timestamptz)
       >= coalesce(scores.timestamp, scores.created_at, '-infinity'::timestamptz)
  returning to_jsonb(scores.*) into v_result;

  -- A stale replay is a successful idempotent no-op. The caller does not need
  -- row data, but returning the durable fact makes the RPC contract explicit.
  if v_result is null then
    select to_jsonb(s.*)
      into v_result
    from public.scores s
    where s.id = p_id::text;
  end if;

  return v_result;
end;
$$;

grant execute on function public.upsert_score_secure(
  uuid, bigint, text, text, text, integer, text, text, text, text, text,
  integer, numeric, timestamptz, timestamptz
) to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260827161500_guard_score_rpc_against_stale_replay',
  'Score RPC stale replay guard',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
