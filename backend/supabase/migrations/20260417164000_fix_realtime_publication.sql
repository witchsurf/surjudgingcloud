-- Migration: Fix Realtime Publication & Efficiency
-- Purpose: Add missing tables to enable full WebSocket synchronization and stop inefficient polling.

-- 1. Ensure REPLICA IDENTITY FULL for tables where we filter by non-PK columns
ALTER TABLE public.active_heat_pointer REPLICA IDENTITY FULL;
ALTER TABLE public.heat_realtime_config REPLICA IDENTITY FULL;
ALTER TABLE public.scores REPLICA IDENTITY FULL;
ALTER TABLE public.heat_entries REPLICA IDENTITY FULL;
ALTER TABLE public.heat_slot_mappings REPLICA IDENTITY FULL;
ALTER TABLE public.interference_calls REPLICA IDENTITY FULL;

-- 2. Add missing tables to the supabase_realtime publication
DO $$
BEGIN
  -- existing fixes
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'heats') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.heats;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'active_heat_pointer') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_heat_pointer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'event_last_config') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_last_config;
  END IF;

  -- NEW: tables needed for scores, interference and participants to stop the 2.5s polling loop
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'scores') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scores;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'heat_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.heat_entries;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'heat_slot_mappings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.heat_slot_mappings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'interference_calls') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.interference_calls;
  END IF;
END
$$;
