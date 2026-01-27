-- Create heat_slot_mappings table to persist bracket advancement placeholders
CREATE TABLE IF NOT EXISTS public.heat_slot_mappings (
    id BIGSERIAL PRIMARY KEY,
    heat_id TEXT NOT NULL REFERENCES public.heats(id) ON DELETE CASCADE,
    position INT NOT NULL,
    placeholder TEXT,
    source_round INT,
    source_heat INT,
    source_position INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS heat_slot_mappings_heat_position_uk
    ON public.heat_slot_mappings(heat_id, position);

CREATE INDEX IF NOT EXISTS heat_slot_mappings_placeholder_idx
    ON public.heat_slot_mappings(placeholder);

-- Enable RLS and provide basic policies mirroring other public tables
ALTER TABLE public.heat_slot_mappings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_slot_mappings_select'
      AND schemaname = 'public'
      AND tablename = 'heat_slot_mappings'
  ) THEN
    EXECUTE 'CREATE POLICY heat_slot_mappings_select ON public.heat_slot_mappings
      FOR SELECT USING (auth.role() IN (''anon'',''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_slot_mappings_insert'
      AND schemaname = 'public'
      AND tablename = 'heat_slot_mappings'
  ) THEN
    EXECUTE 'CREATE POLICY heat_slot_mappings_insert ON public.heat_slot_mappings
      FOR INSERT WITH CHECK (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_slot_mappings_update'
      AND schemaname = 'public'
      AND tablename = 'heat_slot_mappings'
  ) THEN
    EXECUTE 'CREATE POLICY heat_slot_mappings_update ON public.heat_slot_mappings
      FOR UPDATE USING (auth.role() IN (''authenticated'',''service_role''))
      WITH CHECK (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_slot_mappings_delete'
      AND schemaname = 'public'
      AND tablename = 'heat_slot_mappings'
  ) THEN
    EXECUTE 'CREATE POLICY heat_slot_mappings_delete ON public.heat_slot_mappings
      FOR DELETE USING (auth.role() IN (''authenticated'',''service_role''))';
  END IF;
END
$$;
