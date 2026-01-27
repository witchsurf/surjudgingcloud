-- Create participants table if missing
CREATE TABLE IF NOT EXISTS public.participants (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT REFERENCES public.events(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    seed INT NOT NULL,
    name TEXT NOT NULL,
    country TEXT NULL,
    license TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_event_cat_seed_uk
    ON public.participants(event_id, category, seed);

CREATE INDEX IF NOT EXISTS participants_event_category_idx
    ON public.participants(event_id, category);

ALTER TABLE public.heats
    ADD COLUMN IF NOT EXISTS heat_size INT;

-- Create heat_entries table if missing
CREATE TABLE IF NOT EXISTS public.heat_entries (
    id BIGSERIAL PRIMARY KEY,
    heat_id TEXT REFERENCES public.heats(id) ON DELETE CASCADE,
    participant_id BIGINT REFERENCES public.participants(id) ON DELETE CASCADE,
    position INT NOT NULL,
    seed INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS heat_entries_heat_id_idx
    ON public.heat_entries(heat_id);

CREATE INDEX IF NOT EXISTS heat_entries_participant_idx
    ON public.heat_entries(participant_id);
