/*
  # Create missing tables for surf judging system

  1. New Tables
    - `heat_timers`
      - `id` (uuid, primary key)
      - `heat_id` (text, foreign key to heats)
      - `is_running` (boolean)
      - `start_time` (timestamptz, nullable)
      - `duration_minutes` (integer)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `heat_configs`
      - `id` (uuid, primary key)
      - `heat_id` (text, foreign key to heats)
      - `judges` (text array)
      - `surfers` (text array)
      - `judge_names` (jsonb)
      - `waves` (integer)
      - `tournament_type` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on new tables
    - Add policies for public access (competition context)

  3. Performance
    - Add indexes for frequently queried columns
    - Add unique constraints where needed
*/

-- Create heat_timers table
CREATE TABLE IF NOT EXISTS heat_timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id text NOT NULL,
  is_running boolean DEFAULT false,
  start_time timestamptz,
  duration_minutes integer DEFAULT 20,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(heat_id)
);

-- Create heat_configs table
CREATE TABLE IF NOT EXISTS heat_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id text NOT NULL,
  judges text[] NOT NULL,
  surfers text[] NOT NULL,
  judge_names jsonb DEFAULT '{}',
  waves integer DEFAULT 15,
  tournament_type text DEFAULT 'elimination',
  created_at timestamptz DEFAULT now(),
  UNIQUE(heat_id)
);

-- Add foreign key constraints only if heats table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'heats' AND table_schema = 'public') THEN
    -- Add foreign key for heat_timers if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'heat_timers_heat_id_fkey' 
      AND table_name = 'heat_timers'
    ) THEN
      ALTER TABLE heat_timers ADD CONSTRAINT heat_timers_heat_id_fkey 
        FOREIGN KEY (heat_id) REFERENCES heats(id) ON DELETE CASCADE;
    END IF;
    
    -- Add foreign key for heat_configs if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'heat_configs_heat_id_fkey' 
      AND table_name = 'heat_configs'
    ) THEN
      ALTER TABLE heat_configs ADD CONSTRAINT heat_configs_heat_id_fkey 
        FOREIGN KEY (heat_id) REFERENCES heats(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_heat_timers_heat_id ON heat_timers(heat_id);
CREATE INDEX IF NOT EXISTS idx_heat_configs_heat_id ON heat_configs(heat_id);

-- Enable Row Level Security
ALTER TABLE heat_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE heat_configs ENABLE ROW LEVEL SECURITY;

-- Create policies for heat_timers (only if they don't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'heat_timers' AND policyname = 'Allow public read access on heat_timers'
  ) THEN
    CREATE POLICY "Allow public read access on heat_timers"
      ON heat_timers FOR SELECT
      TO public
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'heat_timers' AND policyname = 'Allow public insert on heat_timers'
  ) THEN
    CREATE POLICY "Allow public insert on heat_timers"
      ON heat_timers FOR INSERT
      TO public
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'heat_timers' AND policyname = 'Allow public update on heat_timers'
  ) THEN
    CREATE POLICY "Allow public update on heat_timers"
      ON heat_timers FOR UPDATE
      TO public
      USING (true);
  END IF;
END $$;

-- Create policies for heat_configs (only if they don't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'heat_configs' AND policyname = 'Allow public read access on heat_configs'
  ) THEN
    CREATE POLICY "Allow public read access on heat_configs"
      ON heat_configs FOR SELECT
      TO public
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'heat_configs' AND policyname = 'Allow public insert on heat_configs'
  ) THEN
    CREATE POLICY "Allow public insert on heat_configs"
      ON heat_configs FOR INSERT
      TO public
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'heat_configs' AND policyname = 'Allow public update on heat_configs'
  ) THEN
    CREATE POLICY "Allow public update on heat_configs"
      ON heat_configs FOR UPDATE
      TO public
      USING (true);
  END IF;
END $$;

-- Create or replace function for updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at (only if they don't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_heat_timers_updated_at'
  ) THEN
    CREATE TRIGGER update_heat_timers_updated_at 
      BEFORE UPDATE ON heat_timers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;