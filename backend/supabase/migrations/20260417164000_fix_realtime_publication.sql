-- Migration: Fix Realtime Publication
-- Purpose: Ensure all tables required for judging synchronization are broadcasted via WebSockets

-- 1. Ensure REPLICA IDENTITY FULL for tables where we filter by non-PK columns
-- This is often required for Supabase Realtime to correctly handle specific filters.
ALTER TABLE public.active_heat_pointer REPLICA IDENTITY FULL;
ALTER TABLE public.heat_realtime_config REPLICA IDENTITY FULL;

-- 2. Add missing tables to the supabase_realtime publication
-- Only tables in this publication are broadcasted to connected clients.
-- We check if they are already in the publication first to avoid errors.
DO $$
BEGIN
  -- add heats if missing (tracks closed status)
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'heats') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.heats;
  END IF;

  -- add active_heat_pointer if missing (tracks kiosk auto-switch)
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'active_heat_pointer') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_heat_pointer;
  END IF;

  -- add event_last_config if missing (tracks admin configuration changes)
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'event_last_config') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_last_config;
  END IF;
END
$$;
