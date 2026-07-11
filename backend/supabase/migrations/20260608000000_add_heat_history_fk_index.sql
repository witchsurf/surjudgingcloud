-- Migration: add missing FK index on heat_history.heat_id
-- Identified by Supabase performance advisor (unindexed_foreign_keys lint)
-- Applied 2026-06-08
DO $$
BEGIN
  IF to_regclass('public.heat_history') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_heat_history_heat_id
      ON public.heat_history(heat_id);
  ELSE
    RAISE NOTICE 'Skipping idx_heat_history_heat_id because public.heat_history does not exist';
  END IF;
END $$;
