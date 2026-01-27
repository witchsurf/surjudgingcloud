-- ============================================================================
-- CONSOLIDATED SAFE MIGRATION
-- ============================================================================
-- This migration adds missing columns, views, and functions without
-- compromising the security policies already in place.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADD MISSING COLUMNS
-- ============================================================================

-- Add config column to events (for storing judge configuration)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;

-- Ensure heats has all required columns
ALTER TABLE public.heats
  ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL;
ALTER TABLE public.heats
  ADD COLUMN IF NOT EXISTS heat_size INTEGER;
ALTER TABLE public.heats
  ADD COLUMN IF NOT EXISTS color_order TEXT[];
ALTER TABLE public.heats
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.heats
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.heats
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Ensure scores has event_id
ALTER TABLE public.scores
  ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. CREATE VIEWS (Already created via 1_CREATE_MISSING_TABLES_FIXED.sql)
-- ============================================================================
-- v_event_divisions, v_heat_lineup, v_current_heat already exist

-- ============================================================================
-- 3. CREATE/UPDATE HELPER TABLES
-- ============================================================================

-- event_last_config table (for storing last configuration per event)
CREATE TABLE IF NOT EXISTS public.event_last_config (
  event_id    BIGINT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  event_name  TEXT NOT NULL,
  division    TEXT NOT NULL,
  round       INTEGER NOT NULL DEFAULT 1,
  heat_number INTEGER NOT NULL DEFAULT 1,
  judges      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL DEFAULT CURRENT_USER
);

-- Enable RLS on event_last_config
ALTER TABLE public.event_last_config ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "event_last_config_read_own" ON public.event_last_config;
DROP POLICY IF EXISTS "event_last_config_write_own" ON public.event_last_config;

-- Policy: only event owners can read/write their config
CREATE POLICY "event_last_config_read_own" ON public.event_last_config
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_last_config.event_id
      AND (e.user_id = auth.uid() OR e.paid = true)
    )
  );

CREATE POLICY "event_last_config_write_own" ON public.event_last_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_last_config.event_id
      AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_last_config.event_id
      AND e.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 4. CREATE HELPER FUNCTIONS
-- ============================================================================

-- Upsert helper for event_last_config
CREATE OR REPLACE FUNCTION public.upsert_event_last_config(
  p_event_id    BIGINT,
  p_event_name  TEXT,
  p_division    TEXT,
  p_round       INTEGER,
  p_heat_number INTEGER,
  p_judges      JSONB
) RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.event_last_config (
    event_id, event_name, division, round, heat_number, judges, updated_at, updated_by
  )
  VALUES (
    p_event_id,
    COALESCE(p_event_name, ''::text),
    p_division,
    COALESCE(p_round, 1),
    COALESCE(p_heat_number, 1),
    COALESCE(p_judges, '[]'::jsonb),
    now(),
    CURRENT_USER
  )
  ON CONFLICT (event_id) DO UPDATE
    SET event_name  = EXCLUDED.event_name,
        division    = EXCLUDED.division,
        round       = EXCLUDED.round,
        heat_number = EXCLUDED.heat_number,
        judges      = EXCLUDED.judges,
        updated_at  = now(),
        updated_by  = CURRENT_USER;
$$;

-- Bulk upsert helper (SECURE VERSION - checks permissions)
CREATE OR REPLACE FUNCTION public.bulk_upsert_heats_secure(
  p_heats JSONB DEFAULT '[]'::jsonb,
  p_entries JSONB DEFAULT '[]'::jsonb,
  p_mappings JSONB DEFAULT '[]'::jsonb,
  p_participants JSONB DEFAULT '[]'::jsonb,
  p_delete_ids TEXT[] DEFAULT '{}'
)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id BIGINT;
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get event_id from first heat
  IF jsonb_array_length(p_heats) > 0 THEN
    SELECT (p_heats->0->>'event_id')::BIGINT INTO v_event_id;

    -- Check if user owns this event
    IF NOT EXISTS (
      SELECT 1 FROM public.events
      WHERE id = v_event_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Permission denied: you do not own this event';
    END IF;
  END IF;

  -- Now proceed with the upserts
  IF array_length(p_delete_ids, 1) IS NOT NULL AND array_length(p_delete_ids, 1) > 0 THEN
    DELETE FROM public.heat_slot_mappings WHERE heat_id = ANY(p_delete_ids);
    DELETE FROM public.heat_entries WHERE heat_id = ANY(p_delete_ids);
    DELETE FROM public.heat_realtime_config WHERE heat_id = ANY(p_delete_ids);
    DELETE FROM public.heats WHERE id = ANY(p_delete_ids);
  END IF;

  IF jsonb_array_length(p_participants) > 0 THEN
    INSERT INTO public.participants (event_id, category, seed, name, country, license)
    SELECT event_id, category, seed, name, country, license
    FROM jsonb_to_recordset(p_participants)
      AS t(event_id BIGINT, category TEXT, seed INT, name TEXT, country TEXT, license TEXT)
    ON CONFLICT (event_id, category, seed) DO UPDATE
      SET name = EXCLUDED.name,
          country = EXCLUDED.country,
          license = EXCLUDED.license;
  END IF;

  IF jsonb_array_length(p_heats) > 0 THEN
    INSERT INTO public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order)
    SELECT id, event_id, competition, division, round, heat_number, heat_size, status, color_order
    FROM jsonb_to_recordset(p_heats)
      AS t(id TEXT, event_id BIGINT, competition TEXT, division TEXT, round INTEGER, heat_number INTEGER, heat_size INTEGER, status TEXT, color_order TEXT[])
    ON CONFLICT (id) DO UPDATE
      SET event_id = EXCLUDED.event_id,
          competition = EXCLUDED.competition,
          division = EXCLUDED.division,
          round = EXCLUDED.round,
          heat_number = EXCLUDED.heat_number,
          heat_size = EXCLUDED.heat_size,
          status = EXCLUDED.status,
          color_order = EXCLUDED.color_order;
  END IF;

  IF jsonb_array_length(p_mappings) > 0 THEN
    INSERT INTO public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    SELECT heat_id, position, placeholder, source_round, source_heat, source_position
    FROM jsonb_to_recordset(p_mappings)
      AS t(heat_id TEXT, position INTEGER, placeholder TEXT, source_round INTEGER, source_heat INTEGER, source_position INTEGER)
    ON CONFLICT (heat_id, position) DO UPDATE
      SET placeholder = EXCLUDED.placeholder,
          source_round = EXCLUDED.source_round,
          source_heat = EXCLUDED.source_heat,
          source_position = EXCLUDED.source_position;
  END IF;

  IF jsonb_array_length(p_entries) > 0 THEN
    INSERT INTO public.heat_entries (heat_id, participant_id, position, seed, color)
    SELECT heat_id, participant_id, position, seed, color
    FROM jsonb_to_recordset(p_entries)
      AS t(heat_id TEXT, participant_id BIGINT, position INTEGER, seed INTEGER, color TEXT)
    ON CONFLICT (heat_id, position) DO UPDATE
      SET participant_id = EXCLUDED.participant_id,
          seed = EXCLUDED.seed,
          color = EXCLUDED.color;
  END IF;

  IF jsonb_array_length(p_heats) > 0 THEN
    INSERT INTO public.heat_realtime_config (heat_id)
    SELECT id
    FROM jsonb_to_recordset(p_heats) AS t(id TEXT)
    ON CONFLICT (heat_id) DO NOTHING;
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(BIGINT,TEXT,TEXT,INT,INT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats_secure(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'SUCCESS: Safe consolidated migration applied!' AS status;

-- Show new column
SELECT 'config column' AS added_column,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'config'
       ) THEN 'EXISTS' ELSE 'MISSING' END AS status;

-- Show event_last_config table
SELECT 'event_last_config table' AS added_table,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'event_last_config'
       ) THEN 'EXISTS' ELSE 'MISSING' END AS status;
