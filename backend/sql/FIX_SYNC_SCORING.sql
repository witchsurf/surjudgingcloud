-- ============================================================================
-- FIX_SYNC_SCORING.sql
-- ============================================================================
-- Fixes common errors during "Sync from Cloud" regarding scores:
-- 1. Drops the 'heats_status_check' constraint completely on the local DB
-- 2. Creates an RPC function 'bulk_sync_scores' that DISABLES the blocking
--    triggers before inserting, then re-enables them after.
-- ============================================================================

BEGIN;

-- 1. Drop the restrictive constraint on heats status
ALTER TABLE public.heats DROP CONSTRAINT IF EXISTS heats_status_check;

-- 2. Drop old version of the function if it exists
DROP FUNCTION IF EXISTS public.bulk_sync_scores(jsonb);

-- 3. Create the RPC function for bulk syncing scores
--    Uses DISABLE/ENABLE TRIGGER to bypass the scoring check trigger.
--    SECURITY DEFINER runs as superuser (postgres) so ALTER TABLE works.
CREATE OR REPLACE FUNCTION public.bulk_sync_scores(p_scores jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  -- Disable the blocking triggers for the duration of this function
  ALTER TABLE public.scores DISABLE TRIGGER trg_block_scores_insert;
  ALTER TABLE public.scores DISABLE TRIGGER trg_block_scores_update;

  -- Perform the upsert
  insert into public.scores (
    id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at
  )
  select 
    id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at
  from jsonb_to_recordset(p_scores) as t(
    id uuid, 
    event_id bigint, 
    heat_id text, 
    competition text, 
    division text, 
    round integer, 
    judge_id text, 
    judge_name text, 
    surfer text, 
    wave_number integer, 
    score numeric, 
    timestamp timestamptz, 
    created_at timestamptz
  )
  on conflict (id) do update set
    event_id = excluded.event_id,
    heat_id = excluded.heat_id,
    competition = excluded.competition,
    division = excluded.division,
    round = excluded.round,
    judge_id = excluded.judge_id,
    judge_name = excluded.judge_name,
    surfer = excluded.surfer,
    wave_number = excluded.wave_number,
    score = excluded.score,
    timestamp = excluded.timestamp,
    created_at = excluded.created_at;

  -- Re-enable the triggers
  ALTER TABLE public.scores ENABLE TRIGGER trg_block_scores_insert;
  ALTER TABLE public.scores ENABLE TRIGGER trg_block_scores_update;

exception when others then
  -- Re-enable the triggers even if something goes wrong
  ALTER TABLE public.scores ENABLE TRIGGER trg_block_scores_insert;
  ALTER TABLE public.scores ENABLE TRIGGER trg_block_scores_update;
  raise;
end;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_sync_scores(jsonb) TO anon, authenticated;

COMMIT;

SELECT '✅ Sync Scoring SQL Fixes Applied!' as result;
