-- =====================================================
-- CONSOLIDATED LOCAL DB PATCH
-- Safe to run multiple times (fully idempotent)
-- Creates missing tables, columns and views needed
-- for the full Surf Judging Pro experience on the Event Box
-- =====================================================

BEGIN;

-- =====================================================
-- 1. JUDGES TABLE (standalone judge registry)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.judges (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name text NOT NULL,
    personal_code text NOT NULL DEFAULT '',
    email text,
    phone text,
    certification_level text,
    federation text NOT NULL DEFAULT 'FSS',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.judges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS judges_public_read ON public.judges;
CREATE POLICY judges_public_read ON public.judges FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS judges_authenticated_insert ON public.judges;
CREATE POLICY judges_authenticated_insert ON public.judges FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS judges_authenticated_update ON public.judges;
CREATE POLICY judges_authenticated_update ON public.judges FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS judges_authenticated_delete ON public.judges;
CREATE POLICY judges_authenticated_delete ON public.judges FOR DELETE TO authenticated USING (true);

GRANT SELECT ON public.judges TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.judges TO authenticated;
GRANT ALL ON public.judges TO service_role;

-- =====================================================
-- 2. HEAT_JUDGE_ASSIGNMENTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.heat_judge_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    heat_id text NOT NULL REFERENCES public.heats(id) ON DELETE CASCADE,
    event_id bigint REFERENCES public.events(id) ON DELETE CASCADE,
    station text NOT NULL,
    judge_id text NOT NULL,
    judge_name text NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    assigned_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT heat_judge_assignments_station_check CHECK (char_length(trim(station)) > 0),
    CONSTRAINT heat_judge_assignments_judge_id_check CHECK (char_length(trim(judge_id)) > 0),
    CONSTRAINT heat_judge_assignments_judge_name_check CHECK (char_length(trim(judge_name)) > 0),
    CONSTRAINT heat_judge_assignments_heat_station_unique UNIQUE (heat_id, station)
);

CREATE INDEX IF NOT EXISTS idx_heat_judge_assignments_heat_id ON public.heat_judge_assignments(heat_id);
CREATE INDEX IF NOT EXISTS idx_heat_judge_assignments_event_id ON public.heat_judge_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_heat_judge_assignments_station ON public.heat_judge_assignments(station);

ALTER TABLE public.heat_judge_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read ON public.heat_judge_assignments;
CREATE POLICY public_read ON public.heat_judge_assignments FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS authenticated_insert ON public.heat_judge_assignments;
CREATE POLICY authenticated_insert ON public.heat_judge_assignments FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_update ON public.heat_judge_assignments;
CREATE POLICY authenticated_update ON public.heat_judge_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_delete ON public.heat_judge_assignments;
CREATE POLICY authenticated_delete ON public.heat_judge_assignments FOR DELETE TO authenticated USING (true);

GRANT SELECT ON public.heat_judge_assignments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.heat_judge_assignments TO authenticated;
GRANT ALL ON public.heat_judge_assignments TO service_role;

-- =====================================================
-- 3. MISSING COLUMNS ON scores / score_overrides / interference_calls
-- =====================================================
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS event_id bigint;
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS judge_station text;
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS judge_identity_id text;

DO $$ BEGIN
    ALTER TABLE public.score_overrides ADD COLUMN IF NOT EXISTS judge_station text;
    ALTER TABLE public.score_overrides ADD COLUMN IF NOT EXISTS judge_identity_id text;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.interference_calls ADD COLUMN IF NOT EXISTS judge_station text;
    ALTER TABLE public.interference_calls ADD COLUMN IF NOT EXISTS judge_identity_id text;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_scores_heat_station ON public.scores(heat_id, judge_station);
CREATE INDEX IF NOT EXISTS idx_scores_judge_identity_id ON public.scores(judge_identity_id);

-- =====================================================
-- 4. VIEWS
-- =====================================================
CREATE OR REPLACE VIEW public.v_scores_canonical_enriched AS
WITH ranked_scores AS (
  SELECT
    score.*,
    upper(trim(coalesce(score.judge_station, score.judge_id))) AS judge_station_normalized,
    row_number() OVER (
      PARTITION BY
        score.heat_id,
        upper(trim(coalesce(score.judge_station, score.judge_id))),
        upper(trim(score.surfer)),
        score.wave_number
      ORDER BY
        coalesce(score.timestamp, score.created_at) DESC,
        score.created_at DESC,
        score.id DESC
    ) AS row_rank
  FROM public.scores score
),
resolved_scores AS (
  SELECT
    ranked_scores.id,
    coalesce(heat.event_id, ranked_scores.event_id) AS event_id,
    ranked_scores.heat_id,
    ranked_scores.competition,
    ranked_scores.division,
    ranked_scores.round,
    coalesce(nullif(trim(ranked_scores.judge_identity_id), ''), assignment.judge_id, ranked_scores.judge_id) AS judge_identity_id,
    ranked_scores.judge_station_normalized AS judge_station,
    coalesce(nullif(trim(ranked_scores.judge_name), ''), assignment.judge_name, ranked_scores.judge_id) AS judge_display_name,
    ranked_scores.surfer,
    ranked_scores.wave_number,
    ranked_scores.score,
    ranked_scores.timestamp,
    ranked_scores.created_at
  FROM ranked_scores
  LEFT JOIN public.heats heat ON heat.id = ranked_scores.heat_id
  LEFT JOIN public.heat_judge_assignments assignment
    ON assignment.heat_id = ranked_scores.heat_id
   AND upper(trim(assignment.station)) = ranked_scores.judge_station_normalized
  WHERE ranked_scores.row_rank = 1
)
SELECT * FROM resolved_scores;

CREATE OR REPLACE VIEW public.v_event_judge_assignment_coverage AS
WITH expected_stations AS (
  SELECT
    heat.id AS heat_id,
    heat.event_id,
    heat.competition,
    heat.division,
    heat.round,
    heat.heat_number,
    upper(trim(station.value)) AS station
  FROM public.heats heat
  JOIN public.heat_configs config ON config.heat_id = heat.id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    coalesce(to_jsonb(config.judges), '[]'::jsonb)
  ) AS station(value)
),
resolved_assignments AS (
  SELECT
    assignment.heat_id,
    upper(trim(assignment.station)) AS station,
    nullif(trim(assignment.judge_id), '') AS judge_identity_id,
    nullif(trim(assignment.judge_name), '') AS judge_name
  FROM public.heat_judge_assignments assignment
)
SELECT
  expected.event_id,
  expected.competition,
  expected.division,
  expected.round,
  expected.heat_number,
  expected.heat_id,
  count(*)::integer AS expected_station_count,
  count(*) FILTER (
    WHERE assignment.judge_identity_id IS NOT NULL AND assignment.judge_name IS NOT NULL
  )::integer AS assigned_station_count,
  count(*) FILTER (
    WHERE assignment.judge_identity_id IS NULL OR assignment.judge_name IS NULL
  )::integer AS missing_station_count,
  bool_and(
    assignment.judge_identity_id IS NOT NULL AND assignment.judge_name IS NOT NULL
  ) AS is_complete
FROM expected_stations expected
LEFT JOIN resolved_assignments assignment
  ON assignment.heat_id = expected.heat_id AND assignment.station = expected.station
GROUP BY
  expected.event_id, expected.competition, expected.division,
  expected.round, expected.heat_number, expected.heat_id;

-- Grant views access
GRANT SELECT ON public.v_scores_canonical_enriched TO anon, authenticated, service_role;
GRANT SELECT ON public.v_event_judge_assignment_coverage TO anon, authenticated, service_role;

-- =====================================================
-- 5. ACTIVE_HEAT_POINTER - add event_id column
-- =====================================================
ALTER TABLE public.active_heat_pointer
  ADD COLUMN IF NOT EXISTS event_id bigint REFERENCES public.events(id) ON DELETE CASCADE;

UPDATE public.active_heat_pointer pointer
SET event_id = heat.event_id
FROM public.heats heat
WHERE heat.id = pointer.active_heat_id
  AND heat.event_id IS NOT NULL
  AND pointer.event_id IS DISTINCT FROM heat.event_id;

UPDATE public.active_heat_pointer pointer
SET event_id = event_row.id
FROM public.events event_row
WHERE pointer.event_id IS NULL
  AND lower(trim(coalesce(pointer.event_name, ''))) = lower(trim(coalesce(event_row.name, '')));

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_heat_pointer_event_id_unique
  ON public.active_heat_pointer(event_id)
  WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_sync_active_heat_pointer_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  heat_row record;
BEGIN
  IF new.active_heat_id IS NOT NULL THEN
    SELECT h.event_id, h.competition
      INTO heat_row
    FROM public.heats h
    WHERE h.id = new.active_heat_id;

    IF found THEN
      new.event_id := heat_row.event_id;
      IF coalesce(trim(new.event_name), '') = '' THEN
        new.event_name := heat_row.competition;
      END IF;
    END IF;
  END IF;

  IF new.event_id IS NOT NULL THEN
    SELECT e.name
      INTO new.event_name
    FROM public.events e
    WHERE e.id = new.event_id;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_active_heat_pointer_sync_identity ON public.active_heat_pointer;

CREATE TRIGGER trg_active_heat_pointer_sync_identity
  BEFORE INSERT OR UPDATE OF active_heat_id, event_id, event_name
  ON public.active_heat_pointer
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_active_heat_pointer_identity();

-- =====================================================
-- 6. NOTIFY PostgREST to reload schema cache
-- =====================================================
NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT '✅ Local DB Patch Complete — judges, assignments, scores columns, views all ready!' AS result;
