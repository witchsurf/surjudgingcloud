-- Grant authenticated organisers ability to insert/update their own events
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'insert_own_events'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY insert_own_events
            ON public.events
            FOR INSERT
            TO authenticated
            WITH CHECK (auth.uid() = user_id);
        $policy$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'update_own_events'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY update_own_events
            ON public.events
            FOR UPDATE
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
        $policy$;
    END IF;
END
$$ LANGUAGE plpgsql;
