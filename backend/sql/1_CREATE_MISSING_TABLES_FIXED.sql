-- ============================================================================
-- Step 1: Create Missing Tables & Columns (FIXED)
-- ============================================================================
-- Run this FIRST in Supabase SQL Editor
-- ============================================================================

BEGIN;

-- Add missing columns to heats table
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL;
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS heat_size INTEGER;
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS color_order TEXT[];
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Add missing column to scores table
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL;
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

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

-- Create active_heat_pointer table
CREATE TABLE IF NOT EXISTS public.active_heat_pointer (
  event_name TEXT PRIMARY KEY,
  active_heat_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create event_last_config table
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

CREATE INDEX IF NOT EXISTS heats_event_id_idx
  ON public.heats(event_id);

-- Enable RLS on new tables
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heat_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heat_slot_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_heat_pointer ENABLE ROW LEVEL SECURITY;

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Add updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_trigger ON public.heats;
CREATE TRIGGER set_updated_at_trigger
  BEFORE UPDATE ON public.heats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_trigger ON public.participants;
CREATE TRIGGER set_updated_at_trigger
  BEFORE UPDATE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create views (simplified without color_order dependency)
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
  COALESCE(UPPER(he.color), '') AS jersey_color,
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

-- Create v_current_heat view
CREATE OR REPLACE VIEW public.v_current_heat AS
SELECT
  a.event_name,
  e.id AS event_id,
  a.active_heat_id AS heat_id,
  h.division,
  h.round,
  h.heat_number,
  h.status
FROM public.active_heat_pointer a
JOIN public.heats h ON h.id = a.active_heat_id
JOIN public.events e ON e.name = a.event_name;

COMMIT;

-- Success message
SELECT 'SUCCESS: Missing tables and columns created!' AS status;
