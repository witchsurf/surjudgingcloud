-- ============================================================================
-- CHECK AUTHENTICATION STATUS
-- ============================================================================
-- This script checks if you are authenticated and what user you are
-- ============================================================================

-- Check current authentication
SELECT
  'Current User ID' as check_type,
  COALESCE(auth.uid()::text, 'NOT AUTHENTICATED') as value;

-- Check current role
SELECT
  'Current Role' as check_type,
  current_user as value;

-- List all policies on heat_realtime_config
SELECT
  'heat_realtime_config policies' as info,
  policyname,
  cmd as type,
  CASE
    WHEN roles::text = '{public}' THEN '👥 PUBLIC (everyone)'
    WHEN roles::text = '{authenticated}' THEN '🔐 AUTHENTICATED (logged in users)'
    ELSE roles::text
  END as who_can_use
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'heat_realtime_config'
ORDER BY policyname;

-- Check if you can insert into heat_realtime_config
SELECT
  'Can Insert Test' as check_type,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'heat_realtime_config'
        AND (cmd = 'a' OR cmd = '*')
        AND roles::text LIKE '%public%'
    )
    THEN '✅ YES (public policy exists)'
    WHEN EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'heat_realtime_config'
        AND (cmd = 'a' OR cmd = '*')
        AND roles::text LIKE '%authenticated%'
    )
    THEN '🔐 ONLY IF AUTHENTICATED'
    ELSE '❌ NO INSERT POLICY'
  END as value;

-- Check if you can update heat_realtime_config
SELECT
  'Can Update Test' as check_type,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'heat_realtime_config'
        AND (cmd = 'w' OR cmd = '*')
        AND roles::text LIKE '%public%'
    )
    THEN '✅ YES (public policy exists)'
    WHEN EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'heat_realtime_config'
        AND (cmd = 'w' OR cmd = '*')
        AND roles::text LIKE '%authenticated%'
    )
    THEN '🔐 ONLY IF AUTHENTICATED'
    ELSE '❌ NO UPDATE POLICY'
  END as value;
