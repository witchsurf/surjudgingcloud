-- ==============================================================================
-- FIX: ADD ROBUST SCORE CONSTRAINTS
-- ==============================================================================
-- Adds strict database-level constraints to the scores table to prevent 
-- mathematically impossible scores (must be between 0.00 and 10.00).

BEGIN;

-- 1. Add CHECK constraint for valid score range
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND table_name = 'scores'
          AND constraint_name = 'scores_score_check_range'
    ) THEN
        ALTER TABLE scores
        ADD CONSTRAINT scores_score_check_range 
        CHECK (score >= 0 AND score <= 10);
    END IF;
END $$;

-- 2. Add CHECK constraint for valid wave numbers
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND table_name = 'scores'
          AND constraint_name = 'scores_wave_number_check'
    ) THEN
        ALTER TABLE scores
        ADD CONSTRAINT scores_wave_number_check 
        CHECK (wave_number > 0 AND wave_number <= 30); -- Reasonable upper limit
    END IF;
END $$;

COMMIT;

-- Instructions:
-- Run this script in the Supabase SQL Editor.
