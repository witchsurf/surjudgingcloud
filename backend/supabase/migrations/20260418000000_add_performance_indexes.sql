-- Migration: Add performance indexes for heat_entries and scores
-- Generated automatically to address slow queries.

-- Composite index to support pagination of heat entries ordered by position
CREATE INDEX IF NOT EXISTS idx_heat_entries_heat_id_position
    ON public.heat_entries (heat_id, position);

-- Index to support fast lookup of scores by heat_id (if not already covered by existing composite index)
CREATE INDEX IF NOT EXISTS idx_scores_heat_id
    ON public.scores (heat_id);

-- Optional: index on scores(judge_identity_id) for any future queries (already exists but ensure it)
CREATE INDEX IF NOT EXISTS idx_scores_judge_identity_id
    ON public.scores (judge_identity_id);

COMMIT;
