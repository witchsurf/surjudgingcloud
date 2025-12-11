-- ============================================================================
-- Step 6: Cleanup Exact Old Policies (Based on Diagnostic Output)
-- ============================================================================
-- This uses the EXACT policy names discovered from the diagnostic script
-- Run this to remove old permissive policies while keeping new secure ones
-- ============================================================================

BEGIN;

-- ============================================================================
-- DROP OLD PERMISSIVE POLICIES BY EXACT NAME
-- ============================================================================

-- Events table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.events;
DROP POLICY IF EXISTS "anon_write" ON public.events;
DROP POLICY IF EXISTS "public_read" ON public.events;
DROP POLICY IF EXISTS "auth_write" ON public.events;
DROP POLICY IF EXISTS "auth_update" ON public.events;
DROP POLICY IF EXISTS "Allow public insert on events" ON public.events;
DROP POLICY IF EXISTS "Allow public update on events" ON public.events;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.events;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.events;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.events;

-- Scores table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.scores;
DROP POLICY IF EXISTS "anon_write" ON public.scores;
DROP POLICY IF EXISTS "public_read" ON public.scores;
DROP POLICY IF EXISTS "auth_write" ON public.scores;
DROP POLICY IF EXISTS "auth_update" ON public.scores;
DROP POLICY IF EXISTS "Allow public insert on scores" ON public.scores;
DROP POLICY IF EXISTS "Allow public update on scores" ON public.scores;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.scores;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.scores;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.scores;

-- Heats table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.heats;
DROP POLICY IF EXISTS "anon_write" ON public.heats;
DROP POLICY IF EXISTS "public_read" ON public.heats;
DROP POLICY IF EXISTS "auth_write" ON public.heats;
DROP POLICY IF EXISTS "auth_update" ON public.heats;
DROP POLICY IF EXISTS "Allow public insert on heats" ON public.heats;
DROP POLICY IF EXISTS "Allow public update on heats" ON public.heats;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.heats;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.heats;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.heats;

-- Participants table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.participants;
DROP POLICY IF EXISTS "anon_write" ON public.participants;
DROP POLICY IF EXISTS "public_read" ON public.participants;
DROP POLICY IF EXISTS "auth_write" ON public.participants;
DROP POLICY IF EXISTS "auth_update" ON public.participants;
DROP POLICY IF EXISTS "auth_delete" ON public.participants;
DROP POLICY IF EXISTS "Allow public insert on participants" ON public.participants;
DROP POLICY IF EXISTS "Allow public update on participants" ON public.participants;
DROP POLICY IF EXISTS "Allow public delete on participants" ON public.participants;

-- Heat entries table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.heat_entries;
DROP POLICY IF EXISTS "anon_write" ON public.heat_entries;
DROP POLICY IF EXISTS "public_read" ON public.heat_entries;
DROP POLICY IF EXISTS "auth_write" ON public.heat_entries;
DROP POLICY IF EXISTS "auth_update" ON public.heat_entries;
DROP POLICY IF EXISTS "auth_delete" ON public.heat_entries;
DROP POLICY IF EXISTS "Allow public insert on heat_entries" ON public.heat_entries;
DROP POLICY IF EXISTS "Allow public update on heat_entries" ON public.heat_entries;
DROP POLICY IF EXISTS "Allow public delete on heat_entries" ON public.heat_entries;

-- Heat slot mappings table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "anon_write" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "public_read" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "auth_write" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "auth_update" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "auth_delete" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "Allow public insert on heat_slot_mappings" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "Allow public update on heat_slot_mappings" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "Allow public delete on heat_slot_mappings" ON public.heat_slot_mappings;

-- Heat configs table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.heat_configs;
DROP POLICY IF EXISTS "anon_write" ON public.heat_configs;
DROP POLICY IF EXISTS "public_read" ON public.heat_configs;
DROP POLICY IF EXISTS "auth_write" ON public.heat_configs;
DROP POLICY IF EXISTS "auth_update" ON public.heat_configs;
DROP POLICY IF EXISTS "Allow public insert on heat_configs" ON public.heat_configs;
DROP POLICY IF EXISTS "Allow public update on heat_configs" ON public.heat_configs;

-- Heat timers table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.heat_timers;
DROP POLICY IF EXISTS "anon_write" ON public.heat_timers;
DROP POLICY IF EXISTS "public_read" ON public.heat_timers;
DROP POLICY IF EXISTS "auth_write" ON public.heat_timers;
DROP POLICY IF EXISTS "auth_update" ON public.heat_timers;
DROP POLICY IF EXISTS "Allow public insert on heat_timers" ON public.heat_timers;
DROP POLICY IF EXISTS "Allow public update on heat_timers" ON public.heat_timers;

-- Heat realtime config table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "anon_write" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "public_read" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "auth_write" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "auth_update" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "Allow public insert on heat_realtime_config" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "Allow public update on heat_realtime_config" ON public.heat_realtime_config;

-- Score overrides table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.score_overrides;
DROP POLICY IF EXISTS "anon_write" ON public.score_overrides;
DROP POLICY IF EXISTS "public_read" ON public.score_overrides;
DROP POLICY IF EXISTS "auth_write" ON public.score_overrides;
DROP POLICY IF EXISTS "auth_update" ON public.score_overrides;
DROP POLICY IF EXISTS "Allow public insert on score_overrides" ON public.score_overrides;
DROP POLICY IF EXISTS "Allow public update on score_overrides" ON public.score_overrides;

-- Active heat pointer table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.active_heat_pointer;
DROP POLICY IF EXISTS "anon_write" ON public.active_heat_pointer;
DROP POLICY IF EXISTS "public_read" ON public.active_heat_pointer;
DROP POLICY IF EXISTS "auth_write" ON public.active_heat_pointer;

-- Payments table - Drop old policies
DROP POLICY IF EXISTS "anon_read" ON public.payments;
DROP POLICY IF EXISTS "public_read" ON public.payments;
DROP POLICY IF EXISTS "auth_write" ON public.payments;
DROP POLICY IF EXISTS "Allow public insert on payments" ON public.payments;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'SUCCESS: Old permissive policies removed!' AS status,
       'Run 5_DIAGNOSE_POLICIES.sql again to verify' AS next_step;

-- Show updated policy counts (should be much lower now)
SELECT
  tablename,
  COUNT(*) as policy_count,
  'Expected: 2-4 policies per table' as note
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- Show remaining policies by type
SELECT
  tablename,
  policyname,
  CASE
    WHEN qual::text LIKE '%true%' THEN '⚠️ PERMISSIVE (Check this!)'
    WHEN qual::text LIKE '%auth.uid()%' THEN '✅ User-based (Good)'
    WHEN qual::text LIKE '%user_has_event_access%' THEN '✅ Event-based (Good)'
    WHEN qual::text LIKE '%user_is_judge_for_heat%' THEN '✅ Heat-based (Good)'
    ELSE '❓ Other'
  END as policy_type
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
