-- Enable RLS and add policies for participants and heat_entries
ALTER TABLE IF EXISTS public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.heat_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'participants_select'
      AND schemaname = 'public'
      AND tablename = 'participants'
  ) THEN
    EXECUTE 'CREATE POLICY participants_select ON public.participants
      FOR SELECT USING (auth.role() IN (''anon'',''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'participants_insert'
      AND schemaname = 'public'
      AND tablename = 'participants'
  ) THEN
    EXECUTE 'CREATE POLICY participants_insert ON public.participants
      FOR INSERT WITH CHECK (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'participants_update'
      AND schemaname = 'public'
      AND tablename = 'participants'
  ) THEN
    EXECUTE 'CREATE POLICY participants_update ON public.participants
      FOR UPDATE USING (auth.role() IN (''authenticated'',''service_role''))
      WITH CHECK (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'participants_delete'
      AND schemaname = 'public'
      AND tablename = 'participants'
  ) THEN
    EXECUTE 'CREATE POLICY participants_delete ON public.participants
      FOR DELETE USING (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_entries_select'
      AND schemaname = 'public'
      AND tablename = 'heat_entries'
  ) THEN
    EXECUTE 'CREATE POLICY heat_entries_select ON public.heat_entries
      FOR SELECT USING (auth.role() IN (''anon'',''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_entries_insert'
      AND schemaname = 'public'
      AND tablename = 'heat_entries'
  ) THEN
    EXECUTE 'CREATE POLICY heat_entries_insert ON public.heat_entries
      FOR INSERT WITH CHECK (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_entries_update'
      AND schemaname = 'public'
      AND tablename = 'heat_entries'
  ) THEN
    EXECUTE 'CREATE POLICY heat_entries_update ON public.heat_entries
      FOR UPDATE USING (auth.role() IN (''authenticated'',''service_role''))
      WITH CHECK (auth.role() IN (''authenticated'',''service_role''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'heat_entries_delete'
      AND schemaname = 'public'
      AND tablename = 'heat_entries'
  ) THEN
    EXECUTE 'CREATE POLICY heat_entries_delete ON public.heat_entries
      FOR DELETE USING (auth.role() IN (''authenticated'',''service_role''))';
  END IF;
END
$$;
