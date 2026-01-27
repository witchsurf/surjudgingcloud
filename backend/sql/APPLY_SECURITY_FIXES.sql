-- ============================================================================
-- SAFE SECURITY FIXES - Apply to Existing Database
-- ============================================================================
-- This script safely applies security improvements to an existing database
-- It won't fail if objects already exist
-- ============================================================================

BEGIN;

\echo ''
\echo '============================================'
\echo 'Applying Security Fixes to Existing Database'
\echo '============================================'
\echo ''

-- ============================================================================
-- 1. DROP OLD PERMISSIVE POLICIES (CRITICAL SECURITY FIX)
-- ============================================================================

\echo 'Step 1: Removing old permissive policies...'

-- Events table
DROP POLICY IF EXISTS "read_events_basic" ON public.events;
DROP POLICY IF EXISTS "read_own_or_paid_events" ON public.events;

-- Scores table
DROP POLICY IF EXISTS "Allow public read access on scores" ON public.scores;
DROP POLICY IF EXISTS "authenticated_insert_scores" ON public.scores;
DROP POLICY IF EXISTS "authenticated_update_scores" ON public.scores;

-- Heats table
DROP POLICY IF EXISTS "Allow public read access on heats" ON public.heats;
DROP POLICY IF EXISTS "authenticated_insert_heats" ON public.heats;
DROP POLICY IF EXISTS "authenticated_update_heats" ON public.heats;

-- Heat configs
DROP POLICY IF EXISTS "Allow public read access on heat_configs" ON public.heat_configs;
DROP POLICY IF EXISTS "authenticated_insert_heat_configs" ON public.heat_configs;
DROP POLICY IF EXISTS "authenticated_update_heat_configs" ON public.heat_configs;

-- Heat timers
DROP POLICY IF EXISTS "Allow public read access on heat_timers" ON public.heat_timers;
DROP POLICY IF EXISTS "authenticated_insert_heat_timers" ON public.heat_timers;
DROP POLICY IF EXISTS "authenticated_update_heat_timers" ON public.heat_timers;

-- Score overrides
DROP POLICY IF EXISTS "Allow public read access on score_overrides" ON public.score_overrides;
DROP POLICY IF EXISTS "authenticated_insert_score_overrides" ON public.score_overrides;

-- Participants
DROP POLICY IF EXISTS "participants_select" ON public.participants;
DROP POLICY IF EXISTS "participants_insert_all" ON public.participants;
DROP POLICY IF EXISTS "participants_update_all" ON public.participants;
DROP POLICY IF EXISTS "authenticated_delete_participants" ON public.participants;

-- Heat entries
DROP POLICY IF EXISTS "heat_entries_select" ON public.heat_entries;
DROP POLICY IF EXISTS "heat_entries_insert_all" ON public.heat_entries;
DROP POLICY IF EXISTS "heat_entries_update_all" ON public.heat_entries;
DROP POLICY IF EXISTS "heat_entries_delete" ON public.heat_entries;
DROP POLICY IF EXISTS "authenticated_update_heat_entries" ON public.heat_entries;

-- Heat slot mappings
DROP POLICY IF EXISTS "heat_slot_mappings_select" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "heat_slot_mappings_insert_all" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "heat_slot_mappings_update_all" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "heat_slot_mappings_delete" ON public.heat_slot_mappings;
DROP POLICY IF EXISTS "authenticated_update_heat_slot_mappings" ON public.heat_slot_mappings;

-- Heat realtime config
DROP POLICY IF EXISTS "Allow unified access on heat_realtime_config" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "allow_public_read_access" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "authenticated_update_heat_config" ON public.heat_realtime_config;

\echo '✓ Old policies removed'

-- ============================================================================
-- 2. CREATE HELPER FUNCTIONS
-- ============================================================================

\echo 'Step 2: Creating helper functions...'

CREATE OR REPLACE FUNCTION public.user_has_event_access(p_event_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = p_event_id
    AND (
      user_id = auth.uid()
      OR paid = true
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_judge_for_heat(p_heat_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.heats h
    INNER JOIN public.events e ON e.id = h.event_id
    WHERE h.id = p_heat_id
    AND (
      e.user_id = auth.uid()
      OR e.paid = true
    )
  );
$$;

\echo '✓ Helper functions created'

-- ============================================================================
-- 3. CREATE SECURE RLS POLICIES
-- ============================================================================

\echo 'Step 3: Creating secure RLS policies...'

-- EVENTS
CREATE POLICY "events_read_own_or_paid" ON public.events
  FOR SELECT USING (user_id = auth.uid() OR paid = true);

CREATE POLICY "events_insert_own" ON public.events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "events_update_own" ON public.events
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- HEATS
CREATE POLICY "heats_read_accessible_events" ON public.heats
  FOR SELECT USING (public.user_has_event_access(event_id));

CREATE POLICY "heats_insert_owned_events" ON public.heats
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.events WHERE id = heats.event_id AND user_id = auth.uid()));

CREATE POLICY "heats_update_accessible_events" ON public.heats
  FOR UPDATE TO authenticated
  USING (public.user_has_event_access(event_id))
  WITH CHECK (public.user_has_event_access(event_id));

-- PARTICIPANTS
CREATE POLICY "participants_read_accessible" ON public.participants
  FOR SELECT USING (public.user_has_event_access(event_id));

CREATE POLICY "participants_insert_owned" ON public.participants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.events WHERE id = participants.event_id AND user_id = auth.uid()));

CREATE POLICY "participants_update_owned" ON public.participants
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = participants.event_id AND user_id = auth.uid()));

CREATE POLICY "participants_delete_owned" ON public.participants
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = participants.event_id AND user_id = auth.uid()));

-- SCORES (CRITICAL - Only during running heats)
CREATE POLICY "scores_read_accessible" ON public.scores
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "scores_insert_accessible" ON public.scores
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_judge_for_heat(heat_id)
    AND EXISTS (SELECT 1 FROM public.heat_realtime_config WHERE heat_id = scores.heat_id AND status = 'running')
  );

CREATE POLICY "scores_update_accessible" ON public.scores
  FOR UPDATE TO authenticated
  USING (public.user_is_judge_for_heat(heat_id))
  WITH CHECK (public.user_is_judge_for_heat(heat_id));

-- SCORE OVERRIDES (Only event owners)
CREATE POLICY "score_overrides_read_accessible" ON public.score_overrides
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "score_overrides_insert_owners" ON public.score_overrides
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.heats h
    INNER JOIN public.events e ON e.id = h.event_id
    WHERE h.id = score_overrides.heat_id AND e.user_id = auth.uid()
  ));

-- HEAT ENTRIES
CREATE POLICY "heat_entries_read_accessible" ON public.heat_entries
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_entries_insert_owned" ON public.heat_entries
  FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_entries_update_accessible" ON public.heat_entries
  FOR UPDATE TO authenticated
  USING (public.user_is_judge_for_heat(heat_id))
  WITH CHECK (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_entries_delete_owned" ON public.heat_entries
  FOR DELETE TO authenticated USING (public.user_is_judge_for_heat(heat_id));

-- HEAT SLOT MAPPINGS
CREATE POLICY "heat_slot_mappings_read_accessible" ON public.heat_slot_mappings
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_slot_mappings_insert_accessible" ON public.heat_slot_mappings
  FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_slot_mappings_update_accessible" ON public.heat_slot_mappings
  FOR UPDATE TO authenticated
  USING (public.user_is_judge_for_heat(heat_id))
  WITH CHECK (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_slot_mappings_delete_accessible" ON public.heat_slot_mappings
  FOR DELETE TO authenticated USING (public.user_is_judge_for_heat(heat_id));

-- HEAT CONFIGS
CREATE POLICY "heat_configs_read_accessible" ON public.heat_configs
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_configs_insert_accessible" ON public.heat_configs
  FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_configs_update_accessible" ON public.heat_configs
  FOR UPDATE TO authenticated USING (public.user_is_judge_for_heat(heat_id));

-- HEAT TIMERS
CREATE POLICY "heat_timers_read_accessible" ON public.heat_timers
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_timers_insert_accessible" ON public.heat_timers
  FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_timers_update_accessible" ON public.heat_timers
  FOR UPDATE TO authenticated USING (public.user_is_judge_for_heat(heat_id));

-- HEAT REALTIME CONFIG
CREATE POLICY "heat_realtime_config_read_accessible" ON public.heat_realtime_config
  FOR SELECT USING (public.user_is_judge_for_heat(heat_id));

CREATE POLICY "heat_realtime_config_update_accessible" ON public.heat_realtime_config
  FOR UPDATE TO authenticated
  USING (public.user_is_judge_for_heat(heat_id))
  WITH CHECK (public.user_is_judge_for_heat(heat_id));

\echo '✓ Secure policies created'

-- ============================================================================
-- 4. ADD PERFORMANCE INDEXES (IF NOT EXISTS)
-- ============================================================================

\echo 'Step 4: Creating performance indexes...'

CREATE INDEX IF NOT EXISTS idx_heats_event_division_status
  ON public.heats(event_id, division, status);

CREATE INDEX IF NOT EXISTS idx_heat_entries_heat_id_position
  ON public.heat_entries(heat_id, position);

CREATE INDEX IF NOT EXISTS idx_scores_heat_judge
  ON public.scores(heat_id, judge_id);

CREATE INDEX IF NOT EXISTS idx_participants_event_category_seed
  ON public.participants(event_id, category, seed);

\echo '✓ Performance indexes created'

-- ============================================================================
-- 5. GRANT PERMISSIONS
-- ============================================================================

\echo 'Step 5: Granting permissions...'

GRANT EXECUTE ON FUNCTION public.user_has_event_access(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_judge_for_heat(text) TO authenticated;

\echo '✓ Permissions granted'

COMMIT;

\echo ''
\echo '============================================'
\echo '✅ Security Fixes Applied Successfully!'
\echo '============================================'
\echo ''
\echo 'Summary:'
\echo '  ✓ Removed permissive RLS policies'
\echo '  ✓ Created helper functions for access control'
\echo '  ✓ Applied secure RLS policies'
\echo '  ✓ Added performance indexes'
\echo '  ✓ Granted necessary permissions'
\echo ''
\echo 'Next: Run TEST_MIGRATIONS.sql to verify'
\echo ''
