-- ============================================================================
-- ADDITIONAL FIX: PARTICIPANTS AND TIMER POLICIES
-- ============================================================================
-- This script adds the missing policies for participants and heat_realtime_config
-- that were not in the first version of 8_FIX_DISPLAY_RLS_TEMP.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FIX PARTICIPANTS TABLE POLICIES (CRITICAL for participant names)
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
-- 2. FIX HEAT_REALTIME_CONFIG TABLE POLICIES (CRITICAL for timer sync)
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

SELECT 'PARTICIPANTS AND TIMER POLICIES ADDED' AS status;

SELECT tablename AS table_name, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'heat_realtime_config')
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
-- SUMMARY
-- ============================================================================
--
-- This script adds 2 critical fixes:
--
-- 1. participants_read_all_temp - allows public read of participant names
-- 2. heat_realtime_config_read_all_temp - allows public read of timer
-- 3. heat_realtime_config_write_authenticated_temp - allows authenticated write of timer
--
-- After applying this script:
-- ✅ Participant names will display correctly (not just "BLANC", "BLEU")
-- ✅ Timer will sync properly without 401 errors
-- ✅ Chief Judge can control timer
-- ✅ Display can show timer state
--
-- ============================================================================
