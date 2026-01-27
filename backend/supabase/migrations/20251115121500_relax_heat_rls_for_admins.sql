-- Allow authenticated judges/admins to manage heats even when no Supabase event exists,
-- and expose readonly heat metadata to the public display client.

CREATE OR REPLACE FUNCTION public.user_has_event_access(p_event_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p_event_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = p_event_id
        AND (
          e.user_id = (SELECT auth.uid())
          OR e.paid = true
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_judge_for_heat(p_heat_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.heats h
    LEFT JOIN public.events e ON e.id = h.event_id
    WHERE h.id = p_heat_id
      AND (
        h.event_id IS NULL
        OR e.user_id = (SELECT auth.uid())
        OR e.paid = true
      )
  );
$$;

BEGIN;

-- Heats: public read, authenticated write (event access optional when NULL)
ALTER TABLE public.heats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heats_read_accessible_events" ON public.heats;
CREATE POLICY "heats_read_public"
  ON public.heats
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "heats_insert_owned_events" ON public.heats;
CREATE POLICY "heats_insert_authenticated_manageable"
  ON public.heats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    heats.event_id IS NULL
    OR public.user_has_event_access(heats.event_id)
  );

DROP POLICY IF EXISTS "heats_update_accessible_events" ON public.heats;
CREATE POLICY "heats_update_authenticated_manageable"
  ON public.heats
  FOR UPDATE
  TO authenticated
  USING (
    heats.event_id IS NULL
    OR public.user_has_event_access(heats.event_id)
  )
  WITH CHECK (
    heats.event_id IS NULL
    OR public.user_has_event_access(heats.event_id)
  );

-- Participants: allow public read so displays can show surfer names
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "participants_read_accessible" ON public.participants;
CREATE POLICY "participants_read_public"
  ON public.participants
  FOR SELECT
  TO public
  USING (true);

-- Heat entries metadata should also be publicly readable
ALTER TABLE public.heat_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heat_entries_read_accessible" ON public.heat_entries;
CREATE POLICY "heat_entries_read_public"
  ON public.heat_entries
  FOR SELECT
  TO public
  USING (true);

-- Heat configs must be readable by displays
ALTER TABLE public.heat_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heat_configs_read_accessible" ON public.heat_configs;
CREATE POLICY "heat_configs_read_public"
  ON public.heat_configs
  FOR SELECT
  TO public
  USING (true);

COMMIT;
