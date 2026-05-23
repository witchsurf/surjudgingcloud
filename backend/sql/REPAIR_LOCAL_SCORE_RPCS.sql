-- Repair local score RPCs used by the field/offline replay path.
-- Idempotent on purpose: the HP migration tracker can drift, but these RPCs
-- must exist before local queues are replayed.

begin;

create or replace function public.is_local_database()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  headers text;
  host_header text;
begin
  headers := current_setting('request.headers', true);
  if headers is null or headers = '' then
    return true;
  end if;

  begin
    host_header := headers::json->>'host';
  exception when others then
    return true;
  end;

  if host_header like '%.supabase.co' or host_header like '%.supabase.net' then
    return false;
  end if;

  return true;
end;
$$;

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
set search_path = public, pg_temp
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
    id, event_id, heat_id, competition, division, round,
    judge_id, judge_name, judge_station, judge_identity_id,
    surfer, wave_number, score, timestamp, created_at
  )
  values (
    p_id,
    coalesce(p_event_id, v_heat.event_id),
    v_heat.id,
    coalesce(nullif(trim(coalesce(p_competition, '')), ''), v_heat.competition, 'Competition'),
    coalesce(nullif(trim(coalesce(p_division, '')), ''), v_heat.division, 'OPEN'),
    coalesce(p_round, v_heat.round, 1),
    coalesce(nullif(trim(coalesce(p_judge_id, '')), ''), v_station),
    coalesce(nullif(trim(coalesce(p_judge_name, '')), ''), nullif(trim(coalesce(v_assignment.judge_name, '')), ''), v_station),
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
        created_at = excluded.created_at
  returning to_jsonb(scores.*) into v_result;

  return v_result;
end;
$$;

create or replace function public.record_score_override_secure(
  p_id uuid,
  p_heat_id text,
  p_score_id uuid,
  p_judge_id text,
  p_judge_name text default null,
  p_judge_station text default null,
  p_judge_identity_id text default null,
  p_surfer text default null,
  p_wave_number integer default null,
  p_previous_score numeric default null,
  p_new_score numeric default null,
  p_reason text default null,
  p_comment text default null,
  p_overridden_by text default null,
  p_overridden_by_name text default null,
  p_created_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_score record;
  v_result jsonb;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;
  if p_id is null then
    raise exception 'override id is required';
  end if;

  select *
    into v_score
  from public.scores
  where id = p_score_id::text
    and heat_id = trim(p_heat_id);

  if not found then
    raise exception 'score % not found for heat %', p_score_id, p_heat_id;
  end if;

  insert into public.score_overrides (
    id, heat_id, score_id, judge_id, judge_name, judge_station,
    judge_identity_id, surfer, wave_number, previous_score, new_score,
    reason, comment, overridden_by, overridden_by_name, created_at
  )
  values (
    p_id,
    trim(p_heat_id),
    p_score_id::text,
    coalesce(nullif(trim(coalesce(p_judge_id, '')), ''), v_score.judge_id),
    coalesce(nullif(trim(coalesce(p_judge_name, '')), ''), v_score.judge_name),
    coalesce(nullif(trim(coalesce(p_judge_station, '')), ''), v_score.judge_station, v_score.judge_id),
    nullif(trim(coalesce(p_judge_identity_id, '')), ''),
    coalesce(nullif(trim(coalesce(p_surfer, '')), ''), v_score.surfer),
    coalesce(p_wave_number, v_score.wave_number),
    p_previous_score,
    p_new_score,
    p_reason,
    p_comment,
    p_overridden_by,
    p_overridden_by_name,
    coalesce(p_created_at, now())
  )
  on conflict (id) do update
    set heat_id = excluded.heat_id,
        score_id = excluded.score_id,
        judge_id = excluded.judge_id,
        judge_name = excluded.judge_name,
        judge_station = excluded.judge_station,
        judge_identity_id = excluded.judge_identity_id,
        surfer = excluded.surfer,
        wave_number = excluded.wave_number,
        previous_score = excluded.previous_score,
        new_score = excluded.new_score,
        reason = excluded.reason,
        comment = excluded.comment,
        overridden_by = excluded.overridden_by,
        overridden_by_name = excluded.overridden_by_name,
        created_at = excluded.created_at
  returning to_jsonb(score_overrides.*) into v_result;

  return v_result;
end;
$$;

grant execute on function public.is_local_database() to anon, authenticated, service_role;
grant execute on function public.upsert_score_secure(uuid, bigint, text, text, text, integer, text, text, text, text, text, integer, numeric, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.record_score_override_secure(uuid, text, uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text, text, timestamptz) to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260523215500_robust_scores_trigger_autofill', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
