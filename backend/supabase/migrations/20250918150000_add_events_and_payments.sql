-- Ensure events table exists with expected columns and defaults
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT events_status_check CHECK (status IN ('pending', 'paid', 'failed'))
);

ALTER TABLE public.events
    ALTER COLUMN currency SET DEFAULT 'XOF',
    ALTER COLUMN status SET DEFAULT 'pending',
    ALTER COLUMN paid SET DEFAULT FALSE,
    ALTER COLUMN categories SET DEFAULT '[]'::JSONB,
    ALTER COLUMN judges SET DEFAULT '[]'::JSONB,
    ALTER COLUMN created_at SET DEFAULT timezone('utc', now());

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS method TEXT,
    ADD COLUMN IF NOT EXISTS payment_ref TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_status_check'
          AND conrelid = 'public.events'::regclass
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_status_check CHECK (status IN ('pending', 'paid', 'failed'));
    END IF;
END
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS events_status_idx ON public.events (status);

-- Ensure payments table exists and matches expected contract
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT payments_provider_check CHECK (provider IN ('orange_money', 'wave', 'stripe')),
    CONSTRAINT payments_status_check CHECK (status IN ('pending', 'success', 'failed'))
);

ALTER TABLE public.payments
    ALTER COLUMN currency SET DEFAULT 'XOF',
    ALTER COLUMN status SET DEFAULT 'pending',
    ALTER COLUMN created_at SET DEFAULT timezone('utc', now());

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_provider_check'
          AND conrelid = 'public.payments'::regclass
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_provider_check CHECK (provider IN ('orange_money', 'wave', 'stripe'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_status_check'
          AND conrelid = 'public.payments'::regclass
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'success', 'failed'));
    END IF;
END
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS payments_event_id_idx ON public.payments (event_id);
CREATE INDEX IF NOT EXISTS payments_provider_idx ON public.payments (provider);

-- Ensure heats and scores have an event_id column before managing constraints
ALTER TABLE public.heats
    ADD COLUMN IF NOT EXISTS event_id BIGINT;

ALTER TABLE public.scores
    ADD COLUMN IF NOT EXISTS event_id BIGINT;

-- Enforce desired foreign key behaviour for heats and scores event_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'heats_event_id_fkey'
          AND conrelid = 'public.heats'::regclass
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'heats_event_id_fkey'
          AND conrelid = 'public.heats'::regclass
          AND confrelid = 'public.events'::regclass
          AND confdeltype = 'n'
    ) THEN
        ALTER TABLE public.heats DROP CONSTRAINT heats_event_id_fkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'heats_event_id_fkey'
          AND conrelid = 'public.heats'::regclass
          AND confrelid = 'public.events'::regclass
          AND confdeltype = 'n'
    ) THEN
        ALTER TABLE public.heats
            ADD CONSTRAINT heats_event_id_fkey
            FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'scores_event_id_fkey'
          AND conrelid = 'public.scores'::regclass
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'scores_event_id_fkey'
          AND conrelid = 'public.scores'::regclass
          AND confrelid = 'public.events'::regclass
          AND confdeltype = 'n'
    ) THEN
        ALTER TABLE public.scores DROP CONSTRAINT scores_event_id_fkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'scores_event_id_fkey'
          AND conrelid = 'public.scores'::regclass
          AND confrelid = 'public.events'::regclass
          AND confdeltype = 'n'
    ) THEN
        ALTER TABLE public.scores
            ADD CONSTRAINT scores_event_id_fkey
            FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
    END IF;
END
$$ LANGUAGE plpgsql;

-- Ensure payments table foreign keys use expected delete behaviour if table pre-existed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_event_id_fkey'
          AND conrelid = 'public.payments'::regclass
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_event_id_fkey'
          AND conrelid = 'public.payments'::regclass
          AND confrelid = 'public.events'::regclass
          AND confdeltype = 'c'
    ) THEN
        ALTER TABLE public.payments DROP CONSTRAINT payments_event_id_fkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_event_id_fkey'
          AND conrelid = 'public.payments'::regclass
          AND confrelid = 'public.events'::regclass
          AND confdeltype = 'c'
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_event_id_fkey
            FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
    END IF;
END
$$ LANGUAGE plpgsql;

-- Enable RLS with simple read policies
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'read_events'
    ) THEN
        EXECUTE 'CREATE POLICY read_events ON public.events FOR SELECT USING (true);';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'payments'
          AND policyname = 'read_payments'
    ) THEN
        EXECUTE 'CREATE POLICY read_payments ON public.payments FOR SELECT USING (true);';
    END IF;
END
$$ LANGUAGE plpgsql;
