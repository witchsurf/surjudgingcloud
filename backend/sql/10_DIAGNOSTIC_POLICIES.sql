-- ============================================================================
-- DIAGNOSTIC: Check table and policy status
-- ============================================================================

-- Check if tables exist
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'heat_realtime_config', 'heats', 'scores', 'heat_entries')
ORDER BY tablename;

-- Check ALL policies on ALL tables
SELECT
  tablename,
  policyname,
  CASE cmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END as operation,
  CASE roles::text
    WHEN '{public}' THEN 'public'
    WHEN '{authenticated}' THEN 'authenticated'
    ELSE roles::text
  END as roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Count policies per table
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- Specific check for heat_realtime_config
SELECT
  'heat_realtime_config existence' AS check_type,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'heat_realtime_config')
    THEN 'EXISTS'
    ELSE 'MISSING'
  END AS status;

-- Specific check for participants
SELECT
  'participants existence' AS check_type,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'participants')
    THEN 'EXISTS'
    ELSE 'MISSING'
  END AS status;

-- Check RLS status specifically
SELECT
  tablename,
  CASE
    WHEN rowsecurity THEN 'ENABLED'
    ELSE 'DISABLED'
  END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'heat_realtime_config')
ORDER BY tablename;
