-- Migration: Add bulk_sync_scores RPC for offline data photocopying
-- Description: Allows efficient batch insertion/update of scores fetched from cloud to local HP server.

CREATE OR REPLACE FUNCTION public.bulk_sync_scores(p_scores jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert or update scores from the provided JSON array
  -- We use ON CONFLICT (id) DO UPDATE to ensure existing scores (if any) are refreshed
  INSERT INTO public.scores (
    id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id, created_at
  )
  SELECT
    (row->>'id')::text,
    (row->>'heat_id')::text,
    (row->>'competition')::text,
    (row->>'division')::text,
    (row->>'round')::int,
    (row->>'judge_id')::text,
    (row->>'judge_name')::text,
    (row->>'surfer')::text,
    (row->>'wave_number')::int,
    (row->>'score')::numeric,
    (row->>'timestamp')::timestamptz,
    (row->>'event_id')::bigint,
    (row->>'created_at')::timestamptz
  FROM jsonb_array_elements(p_scores) AS row
  ON CONFLICT (id) DO UPDATE SET
    heat_id = EXCLUDED.heat_id,
    competition = EXCLUDED.competition,
    division = EXCLUDED.division,
    round = EXCLUDED.round,
    judge_id = EXCLUDED.judge_id,
    judge_name = EXCLUDED.judge_name,
    surfer = EXCLUDED.surfer,
    wave_number = EXCLUDED.wave_number,
    score = EXCLUDED.score,
    timestamp = EXCLUDED.timestamp,
    event_id = EXCLUDED.event_id,
    created_at = EXCLUDED.created_at;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.bulk_sync_scores(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.bulk_sync_scores(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_sync_scores(jsonb) TO service_role;
