ALTER TABLE public.heats
ADD COLUMN IF NOT EXISTS color_order TEXT[];

ALTER TABLE public.heat_entries
ADD COLUMN IF NOT EXISTS color TEXT;
