-- Pin search_path on helper/trigger functions flagged by the Supabase linter.
-- This is a low-risk hardening change: it does not alter function logic.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'touch_interference_calls_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.touch_interference_calls_updated_at() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'normalize_heat_id'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.normalize_heat_id(text) SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'trg_normalize_heat_id_heats'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.trg_normalize_heat_id_heats() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'trg_normalize_heat_id_ref'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.trg_normalize_heat_id_ref() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'trg_normalize_active_heat_pointer'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.trg_normalize_active_heat_pointer() SET search_path = public;';
  END IF;
END $$;
