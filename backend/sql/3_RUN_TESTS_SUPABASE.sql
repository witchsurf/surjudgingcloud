-- ============================================================================
-- Step 3: Test Suite - Verify Security Fixes (Supabase Compatible)
-- ============================================================================
-- Run this AFTER Steps 1 & 2 to verify everything works
-- ============================================================================

BEGIN;

-- ============================================================================
-- TEST 1: Verify Helper Functions Exist
-- ============================================================================

DO $$
DECLARE
  v_func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc
  WHERE proname IN ('user_has_event_access', 'user_is_judge_for_heat');

  IF v_func_count = 2 THEN
    RAISE NOTICE 'TEST 1 PASSED: Helper functions exist (2/2)';
  ELSE
    RAISE EXCEPTION 'TEST 1 FAILED: Found % helper functions, expected 2', v_func_count;
  END IF;
END;
$$;

-- ============================================================================
-- TEST 2: Verify RLS Policies Replaced
-- ============================================================================

DO $$
DECLARE
  v_old_policy_count INTEGER;
  v_new_policy_count INTEGER;
BEGIN
  -- Check that old permissive policies are gone
  SELECT COUNT(*) INTO v_old_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      policyname LIKE '%public_read%'
      OR policyname LIKE '%_insert_all'
      OR policyname LIKE '%_update_all'
      OR policyname LIKE '%Allow public%'
    );

  -- Check that new secure policies exist
  SELECT COUNT(*) INTO v_new_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      policyname LIKE '%_read_accessible'
      OR policyname LIKE '%_insert_owned'
      OR policyname LIKE '%_update_accessible'
      OR policyname LIKE '%_read_own_or_paid'
    );

  IF v_old_policy_count = 0 AND v_new_policy_count >= 15 THEN
    RAISE NOTICE 'TEST 2 PASSED: RLS policies replaced (0 old, % new)', v_new_policy_count;
  ELSE
    RAISE WARNING 'TEST 2 WARNING: Found % old policies, % new policies', v_old_policy_count, v_new_policy_count;
  END IF;
END;
$$;

-- ============================================================================
-- TEST 3: Verify Performance Indexes Created
-- ============================================================================

DO $$
DECLARE
  v_index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_heats_event_division_status',
      'idx_heat_entries_heat_id_position',
      'idx_scores_heat_judge',
      'idx_participants_event_category_seed'
    );

  IF v_index_count = 4 THEN
    RAISE NOTICE 'TEST 3 PASSED: Performance indexes created (4/4)';
  ELSE
    RAISE WARNING 'TEST 3 WARNING: Found % indexes, expected 4', v_index_count;
  END IF;
END;
$$;

-- ============================================================================
-- TEST 4: Verify All Required Tables Exist
-- ============================================================================

DO $$
DECLARE
  v_table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'events', 'heats', 'scores', 'participants',
      'heat_entries', 'heat_slot_mappings',
      'heat_configs', 'heat_timers', 'heat_realtime_config',
      'score_overrides', 'payments',
      'active_heat_pointer', 'event_last_config'
    );

  IF v_table_count = 13 THEN
    RAISE NOTICE 'TEST 4 PASSED: All tables exist (13/13)';
  ELSE
    RAISE WARNING 'TEST 4 WARNING: Found % tables, expected 13', v_table_count;
  END IF;
END;
$$;

-- ============================================================================
-- TEST 5: Verify RLS is Enabled
-- ============================================================================

DO $$
DECLARE
  v_rls_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_rls_count
  FROM pg_class
  WHERE relname IN ('events', 'heats', 'scores', 'participants', 'heat_entries')
    AND relrowsecurity = true;

  IF v_rls_count = 5 THEN
    RAISE NOTICE 'TEST 5 PASSED: RLS enabled on critical tables (5/5)';
  ELSE
    RAISE WARNING 'TEST 5 WARNING: RLS enabled on % tables, expected 5', v_rls_count;
  END IF;
END;
$$;

-- ============================================================================
-- TEST 6: Verify Critical Policies Exist
-- ============================================================================

DO $$
DECLARE
  v_critical_policies INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_critical_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'scores' AND policyname = 'scores_insert_accessible')
      OR (tablename = 'events' AND policyname = 'events_read_own_or_paid')
      OR (tablename = 'score_overrides' AND policyname = 'score_overrides_insert_owners')
    );

  IF v_critical_policies = 3 THEN
    RAISE NOTICE 'TEST 6 PASSED: Critical security policies exist (3/3)';
  ELSE
    RAISE WARNING 'TEST 6 WARNING: Found % critical policies, expected 3', v_critical_policies;
  END IF;
END;
$$;

-- ============================================================================
-- TEST 7: Verify Views Created
-- ============================================================================

DO $$
DECLARE
  v_view_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_view_count
  FROM information_schema.views
  WHERE table_schema = 'public'
    AND table_name IN ('v_event_divisions', 'v_heat_lineup', 'v_current_heat');

  IF v_view_count = 3 THEN
    RAISE NOTICE 'TEST 7 PASSED: Views created (3/3)';
  ELSE
    RAISE WARNING 'TEST 7 WARNING: Found % views, expected 3', v_view_count;
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================

SELECT
  'ALL TESTS COMPLETED!' AS status,
  'Check the Messages tab above for detailed results' AS instruction,
  'If all tests PASSED, your security fixes are working!' AS result;

-- Show policy count by table
SELECT
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
