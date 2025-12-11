-- Harden trigger helpers by pinning their search_path and enable leaked password protection.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.update_updated_at_column() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_updated_at() SET search_path = public;';
  END IF;
END $$;

DO $$
DECLARE
  has_auth_set_config boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_config'
      AND n.nspname = 'auth'
  )
  INTO has_auth_set_config;

  IF has_auth_set_config THEN
    EXECUTE 'SELECT auth.set_config(''auth.leaked_password_protection.enabled'', ''true'', true)';
  ELSE
    RAISE NOTICE 'auth.set_config() not available in this environment. Please enable leaked password protection in the Supabase Auth UI.';
  END IF;
END $$;
