-- Migration: Fix Beach Offline Corrections and Accuracy Refresh
-- Location: backend/supabase/migrations/20260523191500_fix_beach_offline_corrections_and_accuracy.sql

begin;

-- =====================================================================
-- SECTION 1: Make Admin score RPCs environment-aware (relax auth on LAN)
-- =====================================================================

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
  -- Only require authentication if running on the Cloud environment (Database Hardening bypass on LAN)
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;

  if p_id is null then
    raise exception 'override id is required';
  end if;

  select *
    into v_score
  from public.scores
  where id = p_score_id
    and heat_id = trim(p_heat_id);

  if not found then
    raise exception 'score % not found for heat %', p_score_id, p_heat_id;
  end if;

  insert into public.score_overrides (
    id,
    heat_id,
    score_id,
    judge_id,
    judge_name,
    judge_station,
    judge_identity_id,
    surfer,
    wave_number,
    previous_score,
    new_score,
    reason,
    comment,
    overridden_by,
    overridden_by_name,
    created_at
  )
  values (
    p_id,
    trim(p_heat_id),
    p_score_id,
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

grant execute on function public.record_score_override_secure(uuid, text, uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text, text, timestamptz) to anon;
grant execute on function public.record_score_override_secure(uuid, text, uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.record_score_override_secure(uuid, text, uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text, text, timestamptz) to service_role;


create or replace function public.apply_score_correction_secure(
  p_score_id uuid,
  p_heat_id text default null,
  p_set_surfer boolean default false,
  p_surfer text default null,
  p_set_wave_number boolean default false,
  p_wave_number integer default null,
  p_set_score boolean default false,
  p_score numeric default null,
  p_timestamp timestamptz default now(),
  p_log_id uuid default null,
  p_log_reason text default null,
  p_log_comment text default null,
  p_log_overridden_by text default null,
  p_log_overridden_by_name text default null,
  p_log_created_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.scores%rowtype;
  v_after public.scores%rowtype;
  v_result jsonb;
begin
  -- Only require authentication if running on the Cloud environment (Database Hardening bypass on LAN)
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;

  select *
    into v_before
  from public.scores
  where id = p_score_id
    and (p_heat_id is null or heat_id = trim(p_heat_id));

  if not found then
    raise exception 'score % not found', p_score_id;
  end if;

  update public.scores
     set surfer = case when p_set_surfer then coalesce(nullif(trim(coalesce(p_surfer, '')), ''), surfer) else surfer end,
         wave_number = case when p_set_wave_number then coalesce(p_wave_number, wave_number) else wave_number end,
         score = case when p_set_score then coalesce(p_score, score) else score end,
         timestamp = coalesce(p_timestamp, now())
   where id = p_score_id
   returning * into v_after;

  if p_log_id is not null then
    perform public.record_score_override_secure(
      p_log_id,
      v_after.heat_id,
      v_after.id,
      v_after.judge_id,
      v_after.judge_name,
      v_after.judge_station,
      v_after.judge_identity_id,
      v_after.surfer,
      v_after.wave_number,
      v_before.score,
      v_after.score,
      p_log_reason,
      p_log_comment,
      p_log_overridden_by,
      p_log_overridden_by_name,
      coalesce(p_log_created_at, p_timestamp, now())
    );
  end if;

  v_result := to_jsonb(v_after);
  return v_result;
end;
$$;

grant execute on function public.apply_score_correction_secure(uuid, text, boolean, text, boolean, integer, boolean, numeric, timestamptz, uuid, text, text, text, text, timestamptz) to anon;
grant execute on function public.apply_score_correction_secure(uuid, text, boolean, text, boolean, integer, boolean, numeric, timestamptz, uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.apply_score_correction_secure(uuid, text, boolean, text, boolean, integer, boolean, numeric, timestamptz, uuid, text, text, text, text, timestamptz) to service_role;

-- =====================================================================
-- SECTION 2: Enable synchronous view refresh in local mode
-- =====================================================================

create or replace function public.trg_queue_accuracy_summary_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Always queue the refresh request for background processing
  insert into public.materialized_view_refresh_queue (view_name, last_refresh_requested_at)
  values ('v_event_judge_accuracy_summary', now())
  on conflict (view_name) do update
  set last_refresh_requested_at = now();

  -- If running in local database mode, perform refresh synchronously
  -- since no bg-cron or worker daemon is active to poll the refresh queue.
  if public.is_local_database() then
    perform public.refresh_judge_accuracy_summary();
  end if;

  return null;
end;
$$;

-- Perform a synchronous one-shot refresh of the materialized view to ensure it is immediately active
select public.refresh_judge_accuracy_summary();

commit;
