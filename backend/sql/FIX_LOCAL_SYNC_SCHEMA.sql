-- ============================================================================
-- FIX_LOCAL_SYNC_SCHEMA.sql
-- ============================================================================
-- Fixes common errors during "Sync from Cloud":
-- 1. Adds missing 'config' column
-- 2. Makes payment columns optional (since they are not used locally)
-- 3. Enables permissive RLS for the local network
-- ============================================================================

BEGIN;

-- 1. Ensure columns exist and have correct types
ALTER TABLE public.events 
  ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS method text;

-- 2. Relax constraints (Make payment/metadata columns nullable for local sync)
ALTER TABLE public.events 
  DROP CONSTRAINT IF EXISTS events_user_id_fkey, -- VERY IMPORTANT: Allows syncing events from cloud users not present locally
  ALTER COLUMN price DROP NOT NULL,
  ALTER COLUMN currency DROP NOT NULL,
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN end_date DROP NOT NULL,
  ALTER COLUMN organizer DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'paid'; -- Default to paid locally to allow viewing

-- 3. Relax Heats constraints
-- Drop the status check which is often too restrictive for synced data
ALTER TABLE public.heats DROP CONSTRAINT IF EXISTS heats_status_check;

-- 4. Relax RLS for Local Mode
-- We enable RLS but add very permissive policies for the local network.
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "local_all_access_events" ON public.events;
CREATE POLICY "local_all_access_events" ON public.events 
  FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Also ensure event_last_config is permissive
ALTER TABLE public.event_last_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "local_all_access_config" ON public.event_last_config;
CREATE POLICY "local_all_access_config" ON public.event_last_config 
  FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Ensure other tables are also permissive for local sync/usage
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heat_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heat_slot_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "local_all_access_participants" ON public.participants;
CREATE POLICY "local_all_access_participants" ON public.participants FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "local_all_access_heats" ON public.heats;
CREATE POLICY "local_all_access_heats" ON public.heats FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "local_all_access_heat_entries" ON public.heat_entries;
CREATE POLICY "local_all_access_heat_entries" ON public.heat_entries FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "local_all_access_heat_slot_mappings" ON public.heat_slot_mappings;
CREATE POLICY "local_all_access_heat_slot_mappings" ON public.heat_slot_mappings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "local_all_access_scores" ON public.scores;
CREATE POLICY "local_all_access_scores" ON public.scores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

COMMIT;

SELECT '✅ Local Sync Schema Fixed!' as result;
