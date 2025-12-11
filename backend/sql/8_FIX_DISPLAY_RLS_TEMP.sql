-- ============================================================================
-- TEMPORARY FIX FOR DISPLAY INTERFACE RLS ISSUES
-- ============================================================================
-- This script temporarily relaxes RLS policies to allow the display interface
-- to function while we refactor the sync logic.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FIX HEATS TABLE POLICIES
-- ============================================================================

-- The display interface tries to create heats records via ensureHeatRecord()
-- but doesn't have event_id. We need to allow authenticated users to insert
-- heats for now (the function user_has_event_access requires event_id).

-- Drop existing insert policy
DROP POLICY IF EXISTS "heats_insert_owned_events" ON public.heats;

-- Create more permissive insert policy for authenticated users
-- TODO: This should be reverted once we fix ensureHeatRecord to not create heats
DROP POLICY IF EXISTS "heats_insert_authenticated_temp" ON public.heats;
CREATE POLICY "heats_insert_authenticated_temp" ON public.heats
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 2. FIX SCORES TABLE POLICIES
-- ============================================================================

-- The display interface tries to sync scores but isn't a "judge" in the system
-- We need to allow authenticated users to insert scores for now

-- Drop existing insert policy
DROP POLICY IF EXISTS "scores_insert_accessible" ON public.scores;

-- Create more permissive insert policy for authenticated users
-- TODO: This should be reverted once we separate display vs judge sync logic
DROP POLICY IF EXISTS "scores_insert_authenticated_temp" ON public.scores;
CREATE POLICY "scores_insert_authenticated_temp" ON public.scores
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 3. FIX HEAT_ENTRIES TABLE POLICIES (for participant names display)
-- ============================================================================

-- The display interface needs to read heat_entries to show participant names
-- but currently only judges can read them. Allow everyone to read.

-- Drop existing read policy
DROP POLICY IF EXISTS "heat_entries_read_accessible" ON public.heat_entries;

-- Create permissive read policy for all authenticated and anonymous users
DROP POLICY IF EXISTS "heat_entries_read_all_temp" ON public.heat_entries;
CREATE POLICY "heat_entries_read_all_temp" ON public.heat_entries
  FOR SELECT TO public
  USING (true);

-- ============================================================================
-- 4. FIX HEAT_SLOT_MAPPINGS TABLE POLICIES
-- ============================================================================

-- The display interface also needs to read heat_slot_mappings for bracket view

-- Drop existing read policy
DROP POLICY IF EXISTS "heat_slot_mappings_read_accessible" ON public.heat_slot_mappings;

-- Create permissive read policy for all authenticated and anonymous users
DROP POLICY IF EXISTS "heat_slot_mappings_read_all_temp" ON public.heat_slot_mappings;
CREATE POLICY "heat_slot_mappings_read_all_temp" ON public.heat_slot_mappings
  FOR SELECT TO public
  USING (true);

-- ============================================================================
-- 5. FIX PARTICIPANTS TABLE POLICIES (CRITICAL for participant names)
-- ============================================================================

-- The display interface needs to read participants to show names/countries
-- Currently only event owners/judges can read participants

-- Drop existing read policy
DROP POLICY IF EXISTS "participants_read_accessible" ON public.participants;

-- Create permissive read policy for all users
DROP POLICY IF EXISTS "participants_read_all_temp" ON public.participants;
CREATE POLICY "participants_read_all_temp" ON public.participants
  FOR SELECT TO public
  USING (true);

-- ============================================================================
-- 6. FIX HEAT_REALTIME_CONFIG TABLE POLICIES (CRITICAL for timer sync)
-- ============================================================================

-- The chief judge needs to write timer state to heat_realtime_config
-- The display needs to read timer state from heat_realtime_config
-- Currently only judges can read/write

-- Drop existing policies
DROP POLICY IF EXISTS "heat_realtime_config_read_accessible" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_update_accessible" ON public.heat_realtime_config;

-- Create permissive policies
DROP POLICY IF EXISTS "heat_realtime_config_read_all_temp" ON public.heat_realtime_config;
CREATE POLICY "heat_realtime_config_read_all_temp" ON public.heat_realtime_config
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "heat_realtime_config_write_authenticated_temp" ON public.heat_realtime_config;
CREATE POLICY "heat_realtime_config_write_authenticated_temp" ON public.heat_realtime_config
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'TEMPORARY FIX APPLIED - ALL POLICIES UPDATED' AS status;

SELECT tablename AS table_name, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('heats', 'scores', 'heat_entries', 'heat_slot_mappings', 'participants', 'heat_realtime_config')
GROUP BY tablename
ORDER BY tablename;

-- Show specific policies for debugging
SELECT
  tablename,
  policyname,
  CASE cmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END as operation
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'heat_realtime_config')
ORDER BY tablename, policyname;

-- ============================================================================
-- IMPORTANT NOTES
-- ============================================================================
--
-- This is a TEMPORARY fix to unblock testing. The following policies are now
-- MORE PERMISSIVE than they should be in production:
--
-- 1. heats - authenticated users can insert (should be: only event owners)
-- 2. scores - authenticated users can insert (should be: only judges during running heats)
-- 3. heat_entries - public read (should be: only judges/event owners)
-- 4. heat_slot_mappings - public read (should be: only judges/event owners)
-- 5. participants - public read (should be: only event owners/judges/paid events)
-- 6. heat_realtime_config - public read + authenticated write (should be: only judges)
--
-- PROPER SOLUTION (for later):
--
-- 1. Stop ensureHeatRecord from creating heats - heats should only be created
--    by the admin interface during heat generation
--
-- 2. Create separate sync hooks:
--    - useSupabaseSync: for judges to write scores
--    - useSupabaseRead: for display to read scores (no writes)
--
-- 3. Add public_display role that can:
--    - Read participants, heat_entries, heat_slot_mappings
--    - Read heat_realtime_config (for timer)
--    - Read scores (for display)
--    - But CANNOT write anything
--
-- 4. Restore the secure policies with proper role-based access
--
-- ============================================================================
