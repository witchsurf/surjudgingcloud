-- Migration: Database Hardening
-- Location: backend/supabase/migrations/20260523000000_database_hardening.sql

begin;

-- =====================================================================
-- SECTION 1: HARDEN SEARCH PATHS ON SECURITY DEFINER FUNCTIONS
-- =====================================================================

DO $$
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN
    SELECT 
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS argument_signature
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true -- SECURITY DEFINER
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp;',
        func_record.schema_name,
        func_record.function_name,
        func_record.argument_signature
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not harden search_path for function: %I.%I (%s): %', 
        func_record.schema_name, func_record.function_name, func_record.argument_signature, SQLERRM;
    END;
  END LOOP;
END $$;


-- =====================================================================
-- SECTION 2: CREATE ENVIRONMENT-AWARE ENVIRONMENT DETECTOR
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_local_database()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  headers text;
  host_header text;
BEGIN
  -- Retrieve request headers set by Kong / PostgREST if any
  headers := current_setting('request.headers', true);
  IF headers IS NULL OR headers = '' THEN
    RETURN true; -- No HTTP headers means local direct connection, or daemon
  END IF;

  BEGIN
    host_header := headers::json->>'host';
  EXCEPTION WHEN OTHERS THEN
    RETURN true; -- Non-JSON or malformed headers means local/test environment
  END IF;

  IF host_header LIKE '%.supabase.co' OR host_header LIKE '%.supabase.net' THEN
    RETURN false; -- Definitely running on Supabase Cloud
  END IF;

  RETURN true; -- Default to local environment
END;
$$;


-- =====================================================================
-- SECTION 3: REFACTOR ACCURACY VIEW TO MATERIALIZED VIEW
-- =====================================================================

-- Drop legacy view (with cascade in case other objects depend on it)
DROP VIEW IF EXISTS public.v_event_judge_accuracy_summary CASCADE;

-- Recreate as Materialized View
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
    AND nullif(trim(score.judge_identity_id), '') IS NOT NULL
    AND upper(trim(score.judge_identity_id)) <> 'CHIEF'
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
      nullif(trim(override_log.judge_identity_id), ''),
      assignment.judge_id,
      nullif(trim(override_log.judge_id), '')
    ) AS judge_identity_id,
    max(
      coalesce(
        nullif(trim(override_log.judge_name), ''),
        assignment.judge_name,
        nullif(trim(override_log.judge_id), '')
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
      nullif(trim(override_log.judge_identity_id), ''),
      assignment.judge_id,
      nullif(trim(override_log.judge_id), '')
    ) IS NOT NULL
    AND upper(trim(coalesce(
      nullif(trim(override_log.judge_identity_id), ''),
      assignment.judge_id,
      nullif(trim(override_log.judge_id), '')
    ))) <> 'CHIEF'
  GROUP BY
    heat.event_id,
    coalesce(
      nullif(trim(override_log.judge_identity_id), ''),
      assignment.judge_id,
      nullif(trim(override_log.judge_id), '')
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
    ) >= 85 THEN 'excellent'
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
    ) >= 70 THEN 'good'
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
    ) >= 55 THEN 'watch'
    ELSE 'needs_review'
  END as quality_band
FROM combined
WHERE combined.event_id IS NOT NULL
  AND combined.scored_waves > 0;

-- Grant select permission on the new materialized view to all roles
GRANT SELECT ON public.v_event_judge_accuracy_summary TO anon, authenticated, service_role;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_v_event_judge_accuracy_summary_uniq 
  ON public.v_event_judge_accuracy_summary (event_id, judge_identity_id);


-- =====================================================================
-- SECTION 4: ASYNCHRONOUS DEBOUNCED REFRESH TRIGGER SYSTEM
-- =====================================================================

-- Refresh queue table
CREATE TABLE IF NOT EXISTS public.materialized_view_refresh_queue (
  view_name text PRIMARY KEY,
  last_refresh_requested_at timestamp with time zone NOT NULL DEFAULT now(),
  last_refreshed_at timestamp with time zone
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.materialized_view_refresh_queue TO anon, authenticated, service_role;

-- Security Definer helper to refresh the view safely
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

-- Queue trigger function for fast transaction completions
CREATE OR REPLACE FUNCTION public.trg_queue_accuracy_summary_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.materialized_view_refresh_queue (view_name, last_refresh_requested_at)
  VALUES ('v_event_judge_accuracy_summary', now())
  ON CONFLICT (view_name) DO UPDATE
  SET last_refresh_requested_at = now();
  RETURN NULL;
END;
$$;

-- Create triggers on scores and score_overrides tables
DROP TRIGGER IF EXISTS trg_refresh_accuracy_scores ON public.scores;
CREATE TRIGGER trg_refresh_accuracy_scores
  AFTER INSERT OR UPDATE OR DELETE ON public.scores
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_queue_accuracy_summary_refresh();

DROP TRIGGER IF EXISTS trg_refresh_accuracy_overrides ON public.score_overrides;
CREATE TRIGGER trg_refresh_accuracy_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.score_overrides
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_queue_accuracy_summary_refresh();


-- =====================================================================
-- SECTION 5: HARDEN CLOUD-SPECIFIC ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================================

-- For the 5 tables, we apply strict environment-aware policies:
-- If we are local, allow everything.
-- If we are cloud, only allow writes if user is authenticated (except payments, which is strictly service_role/owner).
-- Service_role bypasses RLS completely, so the sync daemon remains 100% unimpeded.

-- 1. payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select_policy" ON public.payments;
CREATE POLICY "payments_select_policy"
  ON public.payments FOR SELECT
  TO public
  USING (
    public.is_local_database() 
    OR auth.role() = 'service_role'
    -- Or user owns the event associated with the payment
    OR EXISTS (
      SELECT 1 FROM public.events e 
      WHERE e.id = payments.event_id AND e.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "payments_write_policy" ON public.payments;
CREATE POLICY "payments_write_policy"
  ON public.payments FOR ALL
  TO public
  USING (
    public.is_local_database() 
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    public.is_local_database() 
    OR auth.role() = 'service_role'
  );


-- 2. heat_configs
ALTER TABLE public.heat_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heat_configs_select_policy" ON public.heat_configs;
CREATE POLICY "heat_configs_select_policy"
  ON public.heat_configs FOR SELECT
  TO public
  USING (true); -- Public read-only for displays

DROP POLICY IF EXISTS "heat_configs_write_policy" ON public.heat_configs;
CREATE POLICY "heat_configs_write_policy"
  ON public.heat_configs FOR ALL
  TO public
  USING (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );


-- 3. heat_timers
ALTER TABLE public.heat_timers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heat_timers_select_policy" ON public.heat_timers;
CREATE POLICY "heat_timers_select_policy"
  ON public.heat_timers FOR SELECT
  TO public
  USING (true); -- Public read-only for displays

DROP POLICY IF EXISTS "heat_timers_write_policy" ON public.heat_timers;
CREATE POLICY "heat_timers_write_policy"
  ON public.heat_timers FOR ALL
  TO public
  USING (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );


-- 4. heat_entries
ALTER TABLE public.heat_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heat_entries_select_policy" ON public.heat_entries;
CREATE POLICY "heat_entries_select_policy"
  ON public.heat_entries FOR SELECT
  TO public
  USING (true); -- Public read-only for displays

DROP POLICY IF EXISTS "heat_entries_write_policy" ON public.heat_entries;
CREATE POLICY "heat_entries_write_policy"
  ON public.heat_entries FOR ALL
  TO public
  USING (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );


-- 5. heat_judge_assignments
ALTER TABLE public.heat_judge_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heat_judge_assignments_select_policy" ON public.heat_judge_assignments;
CREATE POLICY "heat_judge_assignments_select_policy"
  ON public.heat_judge_assignments FOR SELECT
  TO public
  USING (true); -- Public read-only for displays

DROP POLICY IF EXISTS "heat_judge_assignments_write_policy" ON public.heat_judge_assignments;
CREATE POLICY "heat_judge_assignments_write_policy"
  ON public.heat_judge_assignments FOR ALL
  TO public
  USING (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    public.is_local_database() 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );

commit;
