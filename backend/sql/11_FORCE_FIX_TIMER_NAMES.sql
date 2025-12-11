-- ============================================================================
-- FORCE FIX: Enable RLS and add policies for participants and heat_realtime_config
-- ============================================================================
-- This script forcefully enables RLS and creates the missing policies
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENSURE RLS IS ENABLED
-- ============================================================================

-- Enable RLS on participants (even if already enabled)
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

-- Enable RLS on heat_realtime_config (even if already enabled)
ALTER TABLE public.heat_realtime_config ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. DROP ALL EXISTING POLICIES (clean slate)
-- ============================================================================

-- Drop all policies on participants
DROP POLICY IF EXISTS "participants_read_accessible" ON public.participants;
DROP POLICY IF EXISTS "participants_read_all_temp" ON public.participants;
DROP POLICY IF EXISTS "participants_insert_owned" ON public.participants;
DROP POLICY IF EXISTS "participants_update_owned" ON public.participants;
DROP POLICY IF EXISTS "participants_delete_owned" ON public.participants;

-- Drop all policies on heat_realtime_config
DROP POLICY IF EXISTS "heat_realtime_config_read_accessible" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_update_accessible" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_read_all_temp" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_write_authenticated_temp" ON public.heat_realtime_config;

-- ============================================================================
-- 3. CREATE NEW PERMISSIVE POLICIES
-- ============================================================================

-- PARTICIPANTS: Allow public read (for displaying names)
CREATE POLICY "participants_read_all_temp" ON public.participants
  FOR SELECT TO public
  USING (true);

-- PARTICIPANTS: Keep write policies for event owners (from original secure policies)
CREATE POLICY "participants_insert_owned" ON public.participants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.events WHERE id = participants.event_id AND user_id = auth.uid()));

CREATE POLICY "participants_update_owned" ON public.participants
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = participants.event_id AND user_id = auth.uid()));

CREATE POLICY "participants_delete_owned" ON public.participants
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = participants.event_id AND user_id = auth.uid()));

-- HEAT_REALTIME_CONFIG: Allow public read (for displaying timer)
CREATE POLICY "heat_realtime_config_read_all_temp" ON public.heat_realtime_config
  FOR SELECT TO public
  USING (true);

-- HEAT_REALTIME_CONFIG: Allow authenticated write (for chief judge to control timer)
CREATE POLICY "heat_realtime_config_write_authenticated_temp" ON public.heat_realtime_config
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT '✅ FORCE FIX APPLIED' AS status;

-- Check RLS is enabled
SELECT
  tablename,
  CASE WHEN rowsecurity THEN '✅ ENABLED' ELSE '❌ DISABLED' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'heat_realtime_config')
ORDER BY tablename;

-- Count policies
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'heat_realtime_config')
GROUP BY tablename
ORDER BY tablename;

-- Show all policies
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
-- EXPECTED RESULT
-- ============================================================================
-- participants: 4 policies (1 read temp + 3 write secure)
-- heat_realtime_config: 2 policies (1 read temp + 1 write temp)
-- ============================================================================
