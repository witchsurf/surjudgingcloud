-- Allow anonymous users to create basic event records when no session exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'public_insert_events'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY public_insert_events
            ON public.events
            FOR INSERT
            TO anon
            WITH CHECK (true);
        $policy$;
    END IF;
END
$$ LANGUAGE plpgsql;
