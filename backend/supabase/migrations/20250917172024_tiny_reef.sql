/*
  # Add realtime configuration table for heat management

  1. New Tables
    - `heat_realtime_config`
      - `heat_id` (text, primary key)
      - `status` (text) - 'waiting', 'running', 'paused', 'finished'
      - `timer_start_time` (timestamptz)
      - `timer_duration_minutes` (integer)
      - `config_data` (jsonb) - full heat configuration
      - `updated_at` (timestamptz)
      - `updated_by` (text) - who made the change

  2. Security
    - Enable RLS on `heat_realtime_config` table
    - Add policy for public read/write access
    - Enable realtime for the table

  3. Functions
    - Auto-update `updated_at` trigger
*/

CREATE TABLE IF NOT EXISTS heat_realtime_config (
  heat_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'paused', 'finished')),
  timer_start_time timestamptz,
  timer_duration_minutes integer DEFAULT 20,
  config_data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  updated_by text DEFAULT 'system'
);

ALTER TABLE heat_realtime_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on heat_realtime_config"
  ON heat_realtime_config
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public write access on heat_realtime_config"
  ON heat_realtime_config
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE heat_realtime_config;

-- Trigger pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_heat_realtime_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_heat_realtime_config_updated_at
  BEFORE UPDATE ON heat_realtime_config
  FOR EACH ROW
  EXECUTE FUNCTION update_heat_realtime_config_updated_at();