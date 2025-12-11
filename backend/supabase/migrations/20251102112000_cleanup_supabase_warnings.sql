-- ✅ Migration corrigée : cleanup_supabase_warnings.sql
-- Rend la migration idempotente et évite les erreurs "policy does not exist"

DO $$
BEGIN
  -- 🔹 Vérifier si la policy existe avant de la modifier
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'read_own_or_paid_events'
      AND tablename = 'events'
  ) THEN
    -- 🧩 Modifier la policy existante
    EXECUTE $sql$
      ALTER POLICY read_own_or_paid_events
      ON public.events
      USING (
        paid
        OR (user_id IS NOT NULL AND (SELECT auth.uid()) = user_id)
      );
    $sql$;
  ELSE
    -- 🆕 Créer la policy si elle n'existe pas
    EXECUTE $sql$
      CREATE POLICY read_own_or_paid_events
      ON public.events
      FOR SELECT
      USING (
        paid
        OR (user_id IS NOT NULL AND (SELECT auth.uid()) = user_id)
      );
    $sql$;
  END IF;
END $$;

-- 🧹 Vérifie aussi que la search_path est correctement fixée sur les fonctions
-- Si la fonction existe, on modifie son search_path
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_heat_realtime_config_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.update_heat_realtime_config_updated_at() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'close_current_heat_and_open_next'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.close_current_heat_and_open_next() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_updated_at() SET search_path = public;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'trigger_close_heat_auto'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER FUNCTION public.trigger_close_heat_auto() SET search_path = public;';
  END IF;
END $$;

-- 🔐 Activer la protection HaveIBeenPwned sur les mots de passe
