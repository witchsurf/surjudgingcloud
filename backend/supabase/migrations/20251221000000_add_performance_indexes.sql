-- Migration: Add Performance Indexes
-- Created: 2024-12-21
-- Purpose: Add indexes to improve query performance for commonly accessed data
-- Part of: Architecture Improvements Phase 1

-- Note: Not using CONCURRENTLY because migration tool runs in transaction
-- Indexes will be created quickly since tables are small

-- Index 1: Heats lookup by event, division, round, and heat number
-- Benefits: Faster heat lookups in kiosk mode and admin interface
-- Common query pattern: WHERE event_id = X AND division = Y AND round = Z
CREATE INDEX IF NOT EXISTS idx_heats_event_division 
  ON heats(event_id, division, round, heat_number);

-- Index 2: Scores lookup by heat ID
-- Benefits: Faster score retrieval for displaying results
-- Common query pattern: WHERE heat_id = X
CREATE INDEX IF NOT EXISTS idx_scores_heat_id 
  ON scores(heat_id);

-- Index 3: Heat entries lookup by heat ID
-- Benefits: Faster retrieval of surfers in a heat
-- Common query pattern: WHERE heat_id = X
CREATE INDEX IF NOT EXISTS idx_heat_entries_heat_id 
  ON heat_entries(heat_id);

-- Index 4: Active heat pointer lookup
-- Benefits: Faster active heat queries (critical for kiosk mode)
-- Common query pattern: WHERE active_heat_id = X
CREATE INDEX IF NOT EXISTS idx_active_heat_pointer_lookup 
  ON active_heat_pointer(active_heat_id);

-- Verify indexes were created
DO $$
BEGIN
  RAISE NOTICE 'Performance indexes created successfully';
  RAISE NOTICE 'Verify with: SELECT indexname, tablename FROM pg_indexes WHERE tablename IN (''heats'', ''scores'', ''heat_entries'', ''active_heat_pointer'');';
END $$;

