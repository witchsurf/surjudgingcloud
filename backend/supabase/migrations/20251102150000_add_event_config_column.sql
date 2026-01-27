-- Allow storing judge configuration metadata directly on events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
