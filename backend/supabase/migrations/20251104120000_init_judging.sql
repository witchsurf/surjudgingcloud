-- Combined idempotent migration for surf judging system
-- Generated: 2025-11-04

-- Heats table
CREATE TABLE IF NOT EXISTS public.heats (
  id text PRIMARY KEY,
  competition text NOT NULL,
  division text NOT NULL,
  round integer NOT NULL,
  heat_number integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  event_id BIGINT,
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_heats_competition_division ON public.heats(competition, division);
CREATE INDEX IF NOT EXISTS idx_heats_status ON public.heats(status);

-- Scores table
CREATE TABLE IF NOT EXISTS public.scores (
  id text PRIMARY KEY,
  heat_id text NOT NULL,
  competition text NOT NULL,
  division text NOT NULL,
  round integer NOT NULL,
  judge_id text NOT NULL,
  judge_name text NOT NULL,
  surfer text NOT NULL,
  wave_number integer NOT NULL,
  score numeric(4,2) NOT NULL CHECK (score >= 0 AND score <= 10),
  timestamp timestamptz NOT NULL,
  event_id BIGINT,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_heat_id ON public.scores(heat_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge_id ON public.scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_scores_surfer ON public.scores(surfer);

-- Heat timers
CREATE TABLE IF NOT EXISTS public.heat_timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id text NOT NULL,
  is_running boolean DEFAULT false,
  start_time timestamptz,
  duration_minutes integer DEFAULT 20,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(heat_id)
);

CREATE INDEX IF NOT EXISTS idx_heat_timers_heat_id ON public.heat_timers(heat_id);

-- Heat configs
CREATE TABLE IF NOT EXISTS public.heat_configs (
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

CREATE INDEX IF NOT EXISTS idx_heat_configs_heat_id ON public.heat_configs(heat_id);

-- Realtime config
CREATE TABLE IF NOT EXISTS public.heat_realtime_config (
  heat_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','running','paused','finished')),
  timer_start_time timestamptz,
  timer_duration_minutes integer DEFAULT 20,
  config_data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  updated_by text DEFAULT 'system'
);

-- Score overrides
CREATE TABLE IF NOT EXISTS public.score_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id text NOT NULL,
  score_id text NOT NULL,
  judge_id text NOT NULL,
  judge_name text NOT NULL,
  surfer text NOT NULL,
  wave_number integer NOT NULL,
  previous_score numeric(4,2),
  new_score numeric(4,2) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('correction','omission','probleme')),
  comment text,
  overridden_by text NOT NULL DEFAULT 'chief_judge',
  overridden_by_name text NOT NULL DEFAULT 'Chef Judge',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_overrides_heat_id ON public.score_overrides(heat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_overrides_score_id ON public.score_overrides(score_id);

-- Events and payments (if you manage events in the same DB)
CREATE TABLE IF NOT EXISTS public.events (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  organizer TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XOF',
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  payment_ref TEXT,
  categories JSONB NOT NULL DEFAULT '[]'::JSONB,
  judges JSONB NOT NULL DEFAULT '[]'::JSONB,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS events_status_idx ON public.events(status);

CREATE TABLE IF NOT EXISTS public.payments (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_ref TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS payments_event_id_idx ON public.payments(event_id);
CREATE INDEX IF NOT EXISTS payments_provider_idx ON public.payments(provider);

-- Foreign keys to heats and scores where applicable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='heats') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'heat_timers_heat_id_fkey' AND table_name = 'heat_timers'
    ) THEN
      BEGIN
        ALTER TABLE public.heat_timers ADD CONSTRAINT heat_timers_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;
      EXCEPTION WHEN others THEN
        -- ignore
      END;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'heat_configs_heat_id_fkey' AND table_name = 'heat_configs'
    ) THEN
      BEGIN
        ALTER TABLE public.heat_configs ADD CONSTRAINT heat_configs_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;
      EXCEPTION WHEN others THEN
        -- ignore
      END;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'scores_heat_id_fkey' AND table_name = 'scores'
    ) THEN
      BEGIN
        ALTER TABLE public.scores ADD CONSTRAINT scores_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;
      EXCEPTION WHEN others THEN
        -- ignore
      END;
    END IF;
  END IF;
END$$ LANGUAGE plpgsql;

-- Enable RLS on runtime tables
ALTER TABLE IF EXISTS public.heats ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.heat_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.heat_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.heat_realtime_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.score_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies that granted public write access
DO $$
BEGIN
  FOR t IN ARRAY['heats','scores','heat_timers','heat_configs','heat_realtime_config','score_overrides','events','payments'] LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='anon_write') THEN
      EXECUTE format('DROP POLICY anon_write ON public.%I;', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='anon_read') THEN
      EXECUTE format('DROP POLICY anon_read ON public.%I;', t);
    END IF;
  END LOOP;
END$$ LANGUAGE plpgsql;

-- Hardened RLS policies: anonymous users may only read public score data,
-- authenticated users manage operational tables, service role bypasses RLS.
DO $$
DECLARE
  t text;
BEGIN
  -- Public read access for heats and scores (no anonymous writes)
  FOR t IN ARRAY['heats','scores'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='public_read') THEN
      EXECUTE format('CREATE POLICY public_read ON public.%I FOR SELECT TO anon, authenticated USING (true);', t);
    END IF;
  END LOOP;

  -- Authenticated-only read for sensitive operational tables
  FOR t IN ARRAY['heat_timers','heat_configs','heat_realtime_config','score_overrides','events','payments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='authenticated_read') THEN
      EXECUTE format('CREATE POLICY authenticated_read ON public.%I FOR SELECT TO authenticated USING (true);', t);
    END IF;
  END LOOP;

  -- Authenticated users can insert new rows
  FOR t IN ARRAY['heats','scores','heat_timers','heat_configs','heat_realtime_config','score_overrides','events','payments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='authenticated_insert') THEN
      EXECUTE format('CREATE POLICY authenticated_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (true);', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='authenticated_update') THEN
      EXECUTE format('CREATE POLICY authenticated_update ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true);', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='authenticated_delete') THEN
      EXECUTE format('CREATE POLICY authenticated_delete ON public.%I FOR DELETE TO authenticated USING (true);', t);
    END IF;
  END LOOP;
END$$ LANGUAGE plpgsql;

-- Triggers: update updated_at where applicable
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='heat_timers') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name='update_heat_timers_updated_at') THEN
      EXECUTE 'CREATE TRIGGER update_heat_timers_updated_at BEFORE UPDATE ON public.heat_timers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='heat_realtime_config') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name='update_heat_realtime_config_updated_at') THEN
      EXECUTE 'CREATE TRIGGER update_heat_realtime_config_updated_at BEFORE UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();';
    END IF;
  END IF;
END$$ LANGUAGE plpgsql;

-- End of migration
