-- Restores secure read/write policies for heat_realtime_config after legacy cleanup.

BEGIN;

ALTER TABLE public.heat_realtime_config ENABLE ROW LEVEL SECURITY;

-- Remove any previous temporary or generic policies
DROP POLICY IF EXISTS "heat_realtime_config_read_accessible" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_update_accessible" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_read_all_temp" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "heat_realtime_config_write_authenticated_temp" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "anon_select_heat_realtime" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "anon_insert_heat_realtime" ON public.heat_realtime_config;
DROP POLICY IF EXISTS "anon_update_heat_realtime" ON public.heat_realtime_config;

-- Public (anon) read access is still required for displays
CREATE POLICY "Users can view heat realtime config"
  ON public.heat_realtime_config
  FOR SELECT
  TO public
  USING (true);

-- Authenticated users (judges/admins) control the timer
CREATE POLICY "Authenticated users can insert heat realtime config"
  ON public.heat_realtime_config
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update heat realtime config"
  ON public.heat_realtime_config
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
