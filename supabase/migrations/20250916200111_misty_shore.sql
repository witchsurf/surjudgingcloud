/*
  # Create surf judging tables

  1. New Tables
    - `heats`
      - `id` (text, primary key) - Format: competition_division_R1_H1
      - `competition` (text)
      - `division` (text)
      - `round` (integer)
      - `heat_number` (integer)
      - `status` (text) - 'open' or 'closed'
      - `created_at` (timestamptz)
      - `closed_at` (timestamptz, nullable)
    
    - `scores`
      - `id` (text, primary key)
      - `heat_id` (text, foreign key)
      - `competition` (text)
      - `division` (text)
      - `round` (integer)
      - `judge_id` (text)
      - `judge_name` (text)
      - `surfer` (text)
      - `wave_number` (integer)
      - `score` (numeric)
      - `timestamp` (timestamptz)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for public read/write (for judging system)
*/

-- Create heats table
CREATE TABLE IF NOT EXISTS heats (
  id text PRIMARY KEY,
  competition text NOT NULL,
  division text NOT NULL,
  round integer NOT NULL,
  heat_number integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

-- Create scores table
CREATE TABLE IF NOT EXISTS scores (
  id text PRIMARY KEY,
  heat_id text NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
  competition text NOT NULL,
  division text NOT NULL,
  round integer NOT NULL,
  judge_id text NOT NULL,
  judge_name text NOT NULL,
  surfer text NOT NULL,
  wave_number integer NOT NULL,
  score numeric(4,2) NOT NULL CHECK (score >= 0 AND score <= 10),
  timestamp timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_heats_competition_division ON heats(competition, division);
CREATE INDEX IF NOT EXISTS idx_heats_status ON heats(status);
CREATE INDEX IF NOT EXISTS idx_scores_heat_id ON scores(heat_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge_id ON scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_scores_surfer ON scores(surfer);

-- Enable Row Level Security
ALTER TABLE heats ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (judging system needs open access)
CREATE POLICY "Allow public read access on heats"
  ON heats
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on heats"
  ON heats
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update on heats"
  ON heats
  FOR UPDATE
  TO public
  USING (true);

CREATE POLICY "Allow public read access on scores"
  ON scores
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on scores"
  ON scores
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update on scores"
  ON scores
  FOR UPDATE
  TO public
  USING (true);