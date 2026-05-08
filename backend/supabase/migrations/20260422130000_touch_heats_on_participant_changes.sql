-- Migration: Touch heats.updated_at when participants change
-- Purpose:
-- - Avoid broad/unfiltered Realtime subscriptions (heat_entries / heat_slot_mappings) on clients.
-- - Let clients subscribe only to `heats` (filtered by event_id) while still reacting to participant changes.
--
-- Notes:
-- - This does NOT delete or rewrite any field data; it only updates heats.updated_at.
-- - Triggers are idempotently created if missing.

CREATE OR REPLACE FUNCTION public.fn_touch_heat_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_heat_id text;
BEGIN
  v_heat_id := COALESCE(NEW.heat_id, OLD.heat_id);
  IF v_heat_id IS NOT NULL AND v_heat_id <> '' THEN
    UPDATE public.heats
       SET updated_at = now()
     WHERE id = v_heat_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'tr_touch_heats_updated_at_heat_entries'
  ) THEN
    CREATE TRIGGER tr_touch_heats_updated_at_heat_entries
    AFTER INSERT OR UPDATE OR DELETE ON public.heat_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_touch_heat_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'tr_touch_heats_updated_at_heat_slot_mappings'
  ) THEN
    CREATE TRIGGER tr_touch_heats_updated_at_heat_slot_mappings
    AFTER INSERT OR UPDATE OR DELETE ON public.heat_slot_mappings
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_touch_heat_updated_at();
  END IF;
END $$;

