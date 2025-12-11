-- ============================================================================
-- CREATE bulk_upsert_heats Function (Non-secure version for backward compat)
-- ============================================================================
-- This creates the function that the code is calling
-- It's a simplified version without security checks (for now)
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_upsert_heats(
  p_heats JSONB DEFAULT '[]'::jsonb,
  p_entries JSONB DEFAULT '[]'::jsonb,
  p_mappings JSONB DEFAULT '[]'::jsonb,
  p_participants JSONB DEFAULT '[]'::jsonb,
  p_delete_ids TEXT[] DEFAULT '{}'
)
RETURNS VOID
LANGUAGE PLPGSQL
AS $$
BEGIN
  -- Delete old heats if overwrite
  IF array_length(p_delete_ids, 1) IS NOT NULL AND array_length(p_delete_ids, 1) > 0 THEN
    DELETE FROM public.heat_slot_mappings WHERE heat_id = ANY(p_delete_ids);
    DELETE FROM public.heat_entries WHERE heat_id = ANY(p_delete_ids);
    DELETE FROM public.heat_realtime_config WHERE heat_id = ANY(p_delete_ids);
    DELETE FROM public.heats WHERE id = ANY(p_delete_ids);
  END IF;

  -- Upsert participants
  IF jsonb_array_length(p_participants) > 0 THEN
    INSERT INTO public.participants (event_id, category, seed, name, country, license)
    SELECT event_id, category, seed, name, country, license
    FROM jsonb_to_recordset(p_participants)
      AS t(event_id BIGINT, category TEXT, seed INT, name TEXT, country TEXT, license TEXT)
    ON CONFLICT (event_id, category, seed) DO UPDATE
      SET name = EXCLUDED.name,
          country = EXCLUDED.country,
          license = EXCLUDED.license;
  END IF;

  -- Insert heats
  IF jsonb_array_length(p_heats) > 0 THEN
    INSERT INTO public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order)
    SELECT id, event_id, competition, division, round, heat_number, heat_size, status, color_order
    FROM jsonb_to_recordset(p_heats)
      AS t(id TEXT, event_id BIGINT, competition TEXT, division TEXT, round INTEGER, heat_number INTEGER, heat_size INTEGER, status TEXT, color_order TEXT[])
    ON CONFLICT (id) DO UPDATE
      SET event_id = EXCLUDED.event_id,
          competition = EXCLUDED.competition,
          division = EXCLUDED.division,
          round = EXCLUDED.round,
          heat_number = EXCLUDED.heat_number,
          heat_size = EXCLUDED.heat_size,
          status = EXCLUDED.status,
          color_order = EXCLUDED.color_order;
  END IF;

  -- Insert mappings
  IF jsonb_array_length(p_mappings) > 0 THEN
    INSERT INTO public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    SELECT heat_id, position, placeholder, source_round, source_heat, source_position
    FROM jsonb_to_recordset(p_mappings)
      AS t(heat_id TEXT, position INTEGER, placeholder TEXT, source_round INTEGER, source_heat INTEGER, source_position INTEGER)
    ON CONFLICT (heat_id, position) DO UPDATE
      SET placeholder = EXCLUDED.placeholder,
          source_round = EXCLUDED.source_round,
          source_heat = EXCLUDED.source_heat,
          source_position = EXCLUDED.source_position;
  END IF;

  -- Insert heat_entries (CRITICAL!)
  IF jsonb_array_length(p_entries) > 0 THEN
    INSERT INTO public.heat_entries (heat_id, participant_id, position, seed, color)
    SELECT heat_id, participant_id, position, seed, color
    FROM jsonb_to_recordset(p_entries)
      AS t(heat_id TEXT, participant_id BIGINT, position INTEGER, seed INTEGER, color TEXT)
    ON CONFLICT (heat_id, position) DO UPDATE
      SET participant_id = EXCLUDED.participant_id,
          seed = EXCLUDED.seed,
          color = EXCLUDED.color;
  END IF;

  -- Create heat_realtime_config entries
  IF jsonb_array_length(p_heats) > 0 THEN
    INSERT INTO public.heat_realtime_config (heat_id)
    SELECT id
    FROM jsonb_to_recordset(p_heats) AS t(id TEXT)
    ON CONFLICT (heat_id) DO NOTHING;
  END IF;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO anon;

COMMIT;

SELECT '✅ bulk_upsert_heats function created' AS status;

-- Verify function exists
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%bulk_upsert%';
