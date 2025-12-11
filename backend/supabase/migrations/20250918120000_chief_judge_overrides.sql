/*
  # Score Overrides Log

  1. New Tables
    - score_overrides
      - id (uuid, primary key)
      - heat_id (text)
      - score_id (text)
      - judge_id (text)
      - judge_name (text)
      - surfer (text)
      - wave_number (integer)
      - previous_score (numeric)
      - new_score (numeric)
      - reason (text)
      - comment (text)
      - overridden_by (text)
      - overridden_by_name (text)
      - created_at (timestamptz)

  2. Security
    - Enable RLS with public read/insert access (anon role)

  3. Indexes
    - Index on heat_id and score_id for fast filtering
*/

CREATE TABLE IF NOT EXISTS score_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id text NOT NULL,
  score_id text NOT NULL,
  judge_id text NOT NULL,
  judge_name text NOT NULL,
  surfer text NOT NULL,
  wave_number integer NOT NULL,
  previous_score numeric(4,2),
  new_score numeric(4,2) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('correction', 'omission', 'probleme')),
  comment text,
  overridden_by text NOT NULL DEFAULT 'chief_judge',
  overridden_by_name text NOT NULL DEFAULT 'Chef Judge',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_overrides_heat_id ON score_overrides(heat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_overrides_score_id ON score_overrides(score_id);

ALTER TABLE score_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on score_overrides"
  ON score_overrides
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on score_overrides"
  ON score_overrides
  FOR INSERT
  TO public
  WITH CHECK (true);
