-- Synchronise l’accès aux événements et paiements
-- 1. Garantir que user_id est toujours renseigné pour les nouveaux événements
-- 2. Restreindre la lecture des événements/paiements aux propriétaires (ou événements payés)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_events_user_id'
  ) THEN
    CREATE FUNCTION public.set_events_user_id()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    BEGIN
      IF NEW.user_id IS NULL THEN
        NEW.user_id := auth.uid();
      END IF;
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_events_user_id_before_insert'
      AND tgrelid = 'public.events'::regclass
  ) THEN
    CREATE TRIGGER set_events_user_id_before_insert
    BEFORE INSERT ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.set_events_user_id();
  END IF;
END
$$;

-- Nettoyage des anciennes policies trop permissives
DROP POLICY IF EXISTS read_events ON public.events;
DROP POLICY IF EXISTS read_payments ON public.payments;

-- Policies affinées
CREATE POLICY read_own_or_paid_events
ON public.events
FOR SELECT
USING (
  (user_id IS NOT NULL AND auth.uid() = user_id)
  OR paid = true
);

CREATE POLICY read_own_payments
ON public.payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_id
      AND e.user_id IS NOT NULL
      AND auth.uid() = e.user_id
  )
);
