-- Add surfer information to event_last_config table
-- This allows Display to show real surfer names instead of just colors

ALTER TABLE public.event_last_config
ADD COLUMN IF NOT EXISTS surfers text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS surfer_names jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS surfer_countries jsonb DEFAULT '{}';

-- Update the upsert function to handle new columns
CREATE OR REPLACE FUNCTION public.upsert_event_last_config(
  p_event_id bigint,
  p_event_name text,
  p_division text,
  p_round integer,
  p_heat_number integer,
  p_judges jsonb,
  p_surfers text[] DEFAULT '{}',
  p_surfer_names jsonb DEFAULT '{}',
  p_surfer_countries jsonb DEFAULT '{}'
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.event_last_config (
    event_id,
    event_name,
    division,
    round,
    heat_number,
    judges,
    surfers,
    surfer_names,
    surfer_countries,
    updated_at,
    updated_by
  )
  VALUES (
    p_event_id,
    COALESCE(p_event_name, ''::text),
    p_division,
    COALESCE(p_round, 1),
    COALESCE(p_heat_number, 1),
    COALESCE(p_judges, '[]'::jsonb),
    COALESCE(p_surfers, '{}'),
    COALESCE(p_surfer_names, '{}'::jsonb),
    COALESCE(p_surfer_countries, '{}'::jsonb),
    now(),
    current_user
  )
  ON CONFLICT (event_id) DO UPDATE
    SET event_name = EXCLUDED.event_name,
        division = EXCLUDED.division,
        round = EXCLUDED.round,
        heat_number = EXCLUDED.heat_number,
        judges = EXCLUDED.judges,
        surfers = EXCLUDED.surfers,
        surfer_names = EXCLUDED.surfer_names,
        surfer_countries = EXCLUDED.surfer_countries,
        updated_at = now(),
        updated_by = current_user;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(bigint,text,text,int,int,jsonb,text[],jsonb,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(bigint,text,text,int,int,jsonb,text[],jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(bigint,text,text,int,int,jsonb,text[],jsonb,jsonb) TO service_role;
