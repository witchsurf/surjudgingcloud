-- ============================================================================
-- Diagnostic: Show All Policy Names
-- ============================================================================
-- This will show us exactly what policies exist so we can remove the right ones
-- ============================================================================

-- Show all policies with details
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  CASE
    WHEN qual::text LIKE '%true%' THEN 'PERMISSIVE (UNSAFE!)'
    WHEN qual::text LIKE '%auth.uid()%' THEN 'User-based (Good)'
    WHEN qual::text LIKE '%user_has_event_access%' THEN 'Event-based (Good)'
    WHEN qual::text LIKE '%user_is_judge_for_heat%' THEN 'Heat-based (Good)'
    ELSE 'Other'
  END as policy_type
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
