-- ============================================================================
-- ULTRA PERMISSIVE FIX: Timer and Participants (Testing Only)
-- ============================================================================
-- This creates the most permissive possible policies to unblock testing
-- WARNING: This is for TESTING ONLY, not production!
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CLEAN SLATE: Remove ALL policies
-- ============================================================================

-- Drop ALL policies on heat_realtime_config (including the mysterious service_delete)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'heat_realtime_config'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.heat_realtime_config', r.policyname);
    END LOOP;
END $$;

-- Drop ALL policies on participants
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'participants'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.participants', r.policyname);
    END LOOP;
END $$;

-- ============================================================================
-- 2. CREATE ULTRA-PERMISSIVE POLICIES (PUBLIC ACCESS)
-- ============================================================================

-- HEAT_REALTIME_CONFIG: Allow EVERYONE (even anonymous) to read
CREATE POLICY "timer_read_public" ON public.heat_realtime_config
  FOR SELECT
  USING (true);

-- HEAT_REALTIME_CONFIG: Allow EVERYONE (even anonymous) to insert
CREATE POLICY "timer_insert_public" ON public.heat_realtime_config
  FOR INSERT
  WITH CHECK (true);

-- HEAT_REALTIME_CONFIG: Allow EVERYONE (even anonymous) to update
CREATE POLICY "timer_update_public" ON public.heat_realtime_config
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- HEAT_REALTIME_CONFIG: Allow EVERYONE (even anonymous) to delete
CREATE POLICY "timer_delete_public" ON public.heat_realtime_config
  FOR DELETE
  USING (true);

-- PARTICIPANTS: Allow EVERYONE to read
CREATE POLICY "participants_read_public" ON public.participants
  FOR SELECT
  USING (true);

-- PARTICIPANTS: Keep write policies for authenticated users (at least some security)
CREATE POLICY "participants_insert_auth" ON public.participants
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "participants_update_auth" ON public.participants
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "participants_delete_auth" ON public.participants
  FOR DELETE TO authenticated
  USING (true);

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT '🚨 ULTRA-PERMISSIVE MODE ENABLED (TESTING ONLY)' AS status;

-- Show policy count
SELECT
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('heat_realtime_config', 'participants')
GROUP BY tablename
ORDER BY tablename;

-- Show all policies with their types
SELECT
  tablename,
  policyname,
  cmd as policy_type,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('heat_realtime_config', 'participants')
ORDER BY tablename, policyname;

-- ============================================================================
-- EXPECTED RESULT
-- ============================================================================
-- heat_realtime_config: 4 policies (read, insert, update, delete - ALL PUBLIC)
-- participants: 4 policies (1 read public + 3 write authenticated)
-- ============================================================================

-- ============================================================================
-- ⚠️ WARNING
-- ============================================================================
-- These policies allow ANYONE to:
-- - Read/write timer state (heat_realtime_config)
-- - Read participant names (participants)
--
-- This is ONLY for testing! Once your app works, you MUST:
-- 1. Implement proper authentication checks
-- 2. Restrict write access to authenticated users with proper roles
-- 3. Use JWT-based security with auth.uid() checks
-- ============================================================================
