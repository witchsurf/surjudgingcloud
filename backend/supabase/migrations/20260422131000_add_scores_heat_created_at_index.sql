-- Migration: Improve scores pagination/order performance
-- Context: PostgREST queries often filter by heat_id and ORDER BY created_at ASC.
-- This composite index avoids sorts and reduces per-request latency under load.

CREATE INDEX IF NOT EXISTS idx_scores_heat_created_at
  ON public.scores USING btree (heat_id, created_at);

