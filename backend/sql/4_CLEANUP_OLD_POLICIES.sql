-- ============================================================================
-- Step 4: Clean Up Old/Duplicate Policies
-- ============================================================================
-- This removes any remaining old policies that weren't caught in Step 2
-- Run this to clean up the high policy counts
-- ============================================================================

BEGIN;

-- ============================================================================
-- EVENTS TABLE - Keep only new secure policies
-- ============================================================================

-- Drop all old event policies
DROP POLICY IF EXISTS "Enable read access for all users" ON public.events;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.events;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.events;
DROP POLICY IF EXISTS "Allow users to insert their own events" ON public.events;
DROP POLICY IF EXISTS "Allow users to update their own events" ON public.events;
DROP POLICY IF EXISTS "Allow users to view all events" ON public.events;
DROP POLICY IF EXISTS "read_all_events" ON public.events;
DROP POLICY IF EXISTS "Allow read access to events" ON public.events;

-- ============================================================================
-- SCORES TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.scores;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.scores;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.scores;
DROP POLICY IF EXISTS "Allow users to insert scores" ON public.scores;
DROP POLICY IF EXISTS "Allow users to update scores" ON public.scores;
DROP POLICY IF EXISTS "Allow users to view all scores" ON public.scores;
DROP POLICY IF EXISTS "read_all_scores" ON public.scores;
DROP POLICY IF EXISTS "insert_all_scores" ON public.scores;
DROP POLICY IF EXISTS "update_all_scores" ON public.scores;

-- ============================================================================
-- HEATS TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.heats;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.heats;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.heats;
DROP POLICY IF EXISTS "Allow users to insert heats" ON public.heats;
DROP POLICY IF EXISTS "Allow users to update heats" ON public.heats;
DROP POLICY IF EXISTS "Allow users to view all heats" ON public.heats;
DROP POLICY IF EXISTS "read_all_heats" ON public.heats;
DROP POLICY IF EXISTS "insert_all_heats" ON public.heats;
DROP POLICY IF EXISTS "update_all_heats" ON public.heats;

-- ============================================================================
-- HEAT_CONFIGS TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.heat_configs;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.heat_configs;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.heat_configs;
DROP POLICY IF EXISTS "Allow users to insert heat configs" ON public.heat_configs;
DROP POLICY IF EXISTS "Allow users to update heat configs" ON public.heat_configs;
DROP POLICY IF EXISTS "Allow users to view all heat configs" ON public.heat_configs;

-- ============================================================================
-- HEAT_TIMERS TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.heat_timers;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.heat_timers;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.heat_timers;
DROP POLICY IF EXISTS "Allow users to insert heat timers" ON public.heat_timers;
DROP POLICY IF EXISTS "Allow users to update heat timers" ON public.heat_timers;
DROP POLICY IF EXISTS "Allow users to view all heat timers" ON public.heat_timers;

-- ============================================================================
-- HEAT_REALTIME_CONFIG TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "Allow users to insert realtime configs" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "Allow users to update realtime configs" ON public.heat_realtime_config;

-- ============================================================================
-- SCORE_OVERRIDES TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.score_overrides;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.score_overrides;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.score_overrides;
DROP POLICY IF EXISTS "Allow users to insert overrides" ON public.score_overrides;
DROP POLICY IF EXISTS "Allow users to update overrides" ON public.score_overrides;

-- ============================================================================
-- PAYMENTS TABLE - Keep only new secure policies
-- ============================================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.payments;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.payments;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.payments;
DROP POLICY IF EXISTS "Allow users to view all payments" ON public.payments;
DROP POLICY IF EXISTS "read_all_payments" ON public.payments;

COMMIT;

-- Success message
SELECT 'SUCCESS: Old policies cleaned up!' AS status,
       'Run the test suite again to verify' AS next_step;

-- Show updated policy counts
SELECT
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
