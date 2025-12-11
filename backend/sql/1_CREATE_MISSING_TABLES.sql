-- ============================================================================
-- Step 1: Create Missing Tables
-- ============================================================================
-- Run this FIRST in Supabase SQL Editor
-- ============================================================================

BEGIN;

-- Create participants table
CREATE TABLE IF NOT EXISTS public.participants (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES public.events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  seed INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  license TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT participants_event_cat_seed_uk UNIQUE (event_id, category, seed)
);

-- Create heat_entries table
CREATE TABLE IF NOT EXISTS public.heat_entries (
  id BIGSERIAL PRIMARY KEY,
  heat_id TEXT REFERENCES public.heats(id) ON DELETE CASCADE,
  participant_id BIGINT REFERENCES public.participants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT heat_entries_unique UNIQUE (heat_id, position)
);

-- Create heat_slot_mappings table
CREATE TABLE IF NOT EXISTS public.heat_slot_mappings (
  id BIGSERIAL PRIMARY KEY,
  heat_id TEXT NOT NULL REFERENCES public.heats(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  placeholder TEXT,
  source_round INTEGER,
  source_heat INTEGER,
  source_position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT heat_slot_mappings_unique UNIQUE (heat_id, position)
);

-- Create active_heat_pointer table (for heat transitions)
CREATE TABLE IF NOT EXISTS public.active_heat_pointer (
  event_name TEXT PRIMARY KEY,
  active_heat_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create event_last_config table (for storing last configuration)
CREATE TABLE IF NOT EXISTS public.event_last_config (
  event_id BIGINT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  division TEXT NOT NULL,
  round INTEGER DEFAULT 1 NOT NULL,
  heat_number INTEGER DEFAULT 1 NOT NULL,
  judges JSONB DEFAULT '[]'::jsonb NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_by TEXT DEFAULT CURRENT_USER NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS participants_event_category_idx
  ON public.participants(event_id, category);

CREATE INDEX IF NOT EXISTS heat_entries_heat_id_idx
  ON public.heat_entries(heat_id);

CREATE INDEX IF NOT EXISTS heat_entries_participant_idx
  ON public.heat_entries(participant_id);

CREATE INDEX IF NOT EXISTS heat_slot_mappings_placeholder_idx
  ON public.heat_slot_mappings(placeholder);

-- Add event_id column to heats if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'heats'
    AND column_name = 'event_id'
  ) THEN
    ALTER TABLE public.heats ADD COLUMN event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add event_id column to scores if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'scores'
    AND column_name = 'event_id'
  ) THEN
    ALTER TABLE public.scores ADD COLUMN event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heat_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heat_slot_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_heat_pointer ENABLE ROW LEVEL SECURITY;

-- Create views
CREATE OR REPLACE VIEW public.v_event_divisions AS
SELECT
  e.id AS event_id,
  e.name AS event_name,
  p.category AS division
FROM public.events e
JOIN public.participants p ON p.event_id = e.id
GROUP BY e.id, e.name, p.category
ORDER BY e.name, p.category;

CREATE OR REPLACE VIEW public.v_heat_lineup AS
SELECT
  h.id AS heat_id,
  h.event_id,
  COALESCE(UPPER(he.color), UPPER(h.color_order[COALESCE(he.position, hm.position)]), '') AS jersey_color,
  COALESCE(p.name, hm.placeholder) AS surfer_name,
  p.country,
  he.seed,
  COALESCE(he.position, hm.position) AS position,
  hm.placeholder,
  hm.source_round,
  hm.source_heat,
  hm.source_position
FROM public.heats h
LEFT JOIN public.heat_entries he ON he.heat_id = h.id
LEFT JOIN public.heat_slot_mappings hm ON hm.heat_id = h.id AND hm.position = COALESCE(he.position, hm.position)
LEFT JOIN public.participants p ON p.id = he.participant_id
ORDER BY h.id, COALESCE(he.position, hm.position);

COMMIT;

-- Success message
SELECT 'SUCCESS: Missing tables created!' AS status;
