-- Removes legacy anon/public/temp policies so only the secure "Users can ..." policies remain.

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        p.polname ~ '^(anon|public)_'
        OR p.polname LIKE '%\_public%'
        OR p.polname LIKE '%\_temp'
        OR p.polname LIKE '%\_display\_%'
      )
  LOOP
    RAISE NOTICE 'Dropping policy "%" on %.%', rec.policyname, rec.schemaname, rec.tablename;
    EXECUTE format('DROP POLICY %I ON %I.%I;', rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;
