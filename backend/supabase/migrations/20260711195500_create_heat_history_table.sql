-- Create heat_history table missing from the HP/local schema.
-- The table exists on Cloud and is referenced by the performance index
-- migration 20260608000000_add_heat_history_fk_index.sql.

CREATE TABLE IF NOT EXISTS public.heat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id text REFERENCES public.heats(id) ON DELETE CASCADE,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone,
  duration_minutes integer,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heat_history_heat_id
  ON public.heat_history(heat_id);

ALTER TABLE public.heat_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.heat_history TO anon;
GRANT ALL ON public.heat_history TO authenticated;
GRANT ALL ON public.heat_history TO service_role;

DROP POLICY IF EXISTS "Heat history is publicly readable" ON public.heat_history;
CREATE POLICY "Heat history is publicly readable"
  ON public.heat_history
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage heat history" ON public.heat_history;
CREATE POLICY "Authenticated users can manage heat history"
  ON public.heat_history
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
