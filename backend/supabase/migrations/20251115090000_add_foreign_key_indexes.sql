-- Adds the covering indexes recommended by Supabase's database linter.
-- Indexes foreign key columns so deletes/updates on the parent tables stay efficient even under load.

-- 1) events.owner_id → auth.users.id (guarded because not every env has owner_id yet)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'owner_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS events_owner_id_idx ON public.events(owner_id)';
  END IF;
END $$;

-- 2) events.user_id → auth.users.id
CREATE INDEX IF NOT EXISTS events_user_id_idx ON public.events(user_id);

-- 3) payments.user_id → auth.users.id
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON public.payments(user_id);
