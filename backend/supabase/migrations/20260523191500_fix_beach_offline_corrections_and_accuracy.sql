-- Migration: Fix Beach Offline Corrections and Accuracy Refresh (Self-Contained)
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
-- SECTION 2: Ensure Materialized View and tracking queue exist locally
-- =====================================================================

-- Recreate view correctly if skipped during bootstrap
DROP VIEW IF EXISTS public.v_event_judge_accuracy_summary CASCADE;

CREATE OR REPLACE FUNCTION public.create_materialized_view_if_missing()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c 
    JOIN pg_namespace n ON c.relnamespace = n.oid 
    WHERE n.nspname = 'public' AND c.relname = 'v_event_judge_accuracy_summary'
  ) THEN
    EXECUTE '
    CREATE MATERIALIZED VIEW public.v_event_judge_accuracy_summary AS
    WITH canonical_scores AS (
      SELECT
        score.event_id,
        score.heat_id,
        score.judge_identity_id,
        score.judge_display_name,
        upper(trim(score.surfer)) AS surfer_key,
        score.wave_number,
        score.score
      FROM public.v_scores_canonical_enriched score
      WHERE score.event_id IS NOT NULL
        AND nullif(trim(score.judge_identity_id), '''') IS NOT NULL
        AND upper(trim(score.judge_identity_id)) <> ''CHIEF''
    ),
    scored_waves AS (
      SELECT
        score.event_id,
        score.judge_identity_id,
        max(score.judge_display_name) AS judge_display_name,
        count(*)::integer AS scored_waves
      FROM canonical_scores score
      GROUP BY score.event_id, score.judge_identity_id
    ),
    wave_consensus AS (
      SELECT
        score.event_id,
        score.judge_identity_id,
        max(score.judge_display_name) AS judge_display_name,
        score.score,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY peer.score) AS consensus_score
      FROM canonical_scores score
      LEFT JOIN canonical_scores peer
        ON peer.event_id = score.event_id
       AND peer.heat_id = score.heat_id
       AND peer.surfer_key = score.surfer_key
       AND peer.wave_number = score.wave_number
       AND peer.judge_identity_id <> score.judge_identity_id
      GROUP BY
        score.event_id,
        score.heat_id,
        score.judge_identity_id,
        score.surfer_key,
        score.wave_number,
        score.score
    ),
    score_accuracy AS (
      SELECT
        wave.event_id,
        wave.judge_identity_id,
        max(wave.judge_display_name) AS judge_display_name,
        count(*) FILTER (WHERE wave.consensus_score IS NOT NULL)::integer AS consensus_samples,
        round(
          coalesce(avg(abs(wave.score - wave.consensus_score)) FILTER (WHERE wave.consensus_score IS NOT NULL), 0)::numeric,
          2
        ) as mean_abs_deviation,
        round(
          coalesce(avg(wave.score - wave.consensus_score) FILTER (WHERE wave.consensus_score IS NOT NULL), 0)::numeric,
          2
        ) as bias,
        round(
          coalesce(
            avg(
              CASE
                WHEN wave.consensus_score IS NULL THEN NULL
                WHEN abs(wave.score - wave.consensus_score) <= 0.5 THEN 100.0
                ELSE 0.0
              END
            ),
            0
          )::numeric,
          2
        ) as within_half_point_rate
      FROM wave_consensus wave
      GROUP BY wave.event_id, wave.judge_identity_id
    ),
    override_stats AS (
      SELECT
        heat.event_id AS event_id,
        coalesce(
          nullif(trim(override_log.judge_identity_id), ''''),
          assignment.judge_id,
          nullif(trim(override_log.judge_id), '''')
        ) AS judge_identity_id,
        max(
          coalesce(
            nullif(trim(override_log.judge_name), ''''),
            assignment.judge_name,
            nullif(trim(override_log.judge_id), '''')
          )
        ) AS judge_display_name,
        count(*)::integer AS override_count,
        round(
          coalesce(avg(abs(coalesce(override_log.new_score, 0) - coalesce(override_log.previous_score, 0))), 0)::numeric,
          2
        ) as average_override_delta
      FROM public.score_overrides override_log
      LEFT JOIN public.heats heat
        ON heat.id = override_log.heat_id
      LEFT JOIN public.heat_judge_assignments assignment
        ON assignment.heat_id = override_log.heat_id
       AND upper(trim(assignment.station)) = upper(trim(coalesce(override_log.judge_station, override_log.judge_id)))
      WHERE heat.event_id IS NOT NULL
        AND coalesce(
          nullif(trim(override_log.judge_identity_id), ''''),
          assignment.judge_id,
          nullif(trim(override_log.judge_id), '''')
        ) IS NOT NULL
        AND upper(trim(coalesce(
          nullif(trim(override_log.judge_identity_id), ''''),
          assignment.judge_id,
          nullif(trim(override_log.judge_id), '''')
        ))) <> ''CHIEF''
      GROUP BY
        heat.event_id,
        coalesce(
          nullif(trim(override_log.judge_identity_id), ''''),
          assignment.judge_id,
          nullif(trim(override_log.judge_id), '''')
        )
    ),
    combined AS (
      SELECT
        coalesce(score_stats.event_id, override_stats.event_id) AS event_id,
        coalesce(score_stats.judge_identity_id, override_stats.judge_identity_id) AS judge_identity_id,
        coalesce(score_stats.judge_display_name, override_stats.judge_display_name, coalesce(score_stats.judge_identity_id, override_stats.judge_identity_id)) AS judge_display_name,
        coalesce(scored.scored_waves, 0) AS scored_waves,
        coalesce(score_stats.consensus_samples, 0) AS consensus_samples,
        coalesce(score_stats.mean_abs_deviation, 0) AS mean_abs_deviation,
        coalesce(score_stats.bias, 0) AS bias,
        coalesce(score_stats.within_half_point_rate, 0) AS within_half_point_rate,
        coalesce(override_stats.override_count, 0) AS override_count,
        coalesce(
          round(
            CASE
              WHEN coalesce(scored.scored_waves, 0) > 0
                THEN (coalesce(override_stats.override_count, 0)::numeric / scored.scored_waves::numeric) * 100
              ELSE 0
            END,
            2
          ),
          0
        ) as override_rate,
        coalesce(override_stats.average_override_delta, 0) as average_override_delta
      FROM score_accuracy score_stats
      FULL OUTER JOIN override_stats
        ON override_stats.event_id = score_stats.event_id
       AND override_stats.judge_identity_id = score_stats.judge_identity_id
      LEFT JOIN scored_waves scored
        ON scored.event_id = coalesce(score_stats.event_id, override_stats.event_id)
       AND scored.judge_identity_id = coalesce(score_stats.judge_identity_id, override_stats.judge_identity_id)
    )
    SELECT
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
      CASE
        WHEN greatest(
          0,
          least(
            100,
            100
            - least(45, combined.mean_abs_deviation * 30)
            - least(15, abs(combined.bias) * 20)
            - least(20, combined.override_rate * 0.5)
            + least(10, combined.within_half_point_rate * 0.1)
          )
        ) >= 85 THEN ''excellent''
        WHEN greatest(
          0,
          least(
            100,
            100
            - least(45, combined.mean_abs_deviation * 30)
            - least(15, abs(combined.bias) * 20)
            - least(20, combined.override_rate * 0.5)
            + least(10, combined.within_half_point_rate * 0.1)
          )
        ) >= 70 THEN ''good''
        WHEN greatest(
          0,
          least(
            100,
            100
            - least(45, combined.mean_abs_deviation * 30)
            - least(15, abs(combined.bias) * 20)
            - least(20, combined.override_rate * 0.5)
            + least(10, combined.within_half_point_rate * 0.1)
          )
        ) >= 55 THEN ''watch''
        ELSE ''needs_review''
      END as quality_band
    FROM combined
    WHERE combined.event_id IS NOT NULL
      AND combined.scored_waves > 0;
    ';
    
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_v_event_judge_accuracy_summary_uniq 
      ON public.v_event_judge_accuracy_summary (event_id, judge_identity_id);';
  END IF;
END;
$$;

SELECT public.create_materialized_view_if_missing();
DROP FUNCTION public.create_materialized_view_if_missing();

GRANT SELECT ON public.v_event_judge_accuracy_summary TO anon, authenticated, service_role;

-- Ensure tracking table exists
CREATE TABLE IF NOT EXISTS public.materialized_view_refresh_queue (
  view_name text PRIMARY KEY,
  last_refresh_requested_at timestamp with time zone NOT NULL DEFAULT now(),
  last_refreshed_at timestamp with time zone
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.materialized_view_refresh_queue TO anon, authenticated, service_role;

-- =====================================================================
-- SECTION 3: Create View Refresh and Sync functions
-- =====================================================================

CREATE OR REPLACE FUNCTION public.refresh_judge_accuracy_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_event_judge_accuracy_summary;
  
  -- Record the completion timestamp
  INSERT INTO public.materialized_view_refresh_queue (view_name, last_refreshed_at)
  VALUES ('v_event_judge_accuracy_summary', now())
  ON CONFLICT (view_name) DO UPDATE
  SET last_refreshed_at = now();
EXCEPTION WHEN OTHERS THEN
  -- Fallback to standard refresh if concurrent is not available (e.g. index build/lock issues)
  REFRESH MATERIALIZED VIEW public.v_event_judge_accuracy_summary;
  
  INSERT INTO public.materialized_view_refresh_queue (view_name, last_refreshed_at)
  VALUES ('v_event_judge_accuracy_summary', now())
  ON CONFLICT (view_name) DO UPDATE
  SET last_refreshed_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_judge_accuracy_summary() TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.trg_queue_accuracy_summary_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
