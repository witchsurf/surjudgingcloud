-- Ensure helper RLS functions and policies only evaluate auth.* calls once per statement.

CREATE OR REPLACE FUNCTION public.user_has_event_access(p_event_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events
    WHERE id = p_event_id
      AND (
        user_id = (SELECT auth.uid())
        OR paid = true
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_judge_for_heat(p_heat_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.heats h
    INNER JOIN public.events e ON e.id = h.event_id
    WHERE h.id = p_heat_id
      AND (
        e.user_id = (SELECT auth.uid())
        OR e.paid = true
      )
  );
$$;

DO $$
DECLARE
  rec record;
  new_using text;
  new_check text;
  changed boolean;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      c.oid AS relid,
      pg_get_expr(p.polqual, c.oid) AS using_expr,
      pg_get_expr(p.polwithcheck, c.oid) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        (pg_get_expr(p.polqual, c.oid) ILIKE '%auth.%'
         OR pg_get_expr(p.polwithcheck, c.oid) ILIKE '%auth.%')
        OR (pg_get_expr(p.polqual, c.oid) ILIKE '%current_setting%'
         OR pg_get_expr(p.polwithcheck, c.oid) ILIKE '%current_setting%')
      )
  LOOP
    new_using := rec.using_expr;
    new_check := rec.check_expr;
    changed := false;

    IF new_using IS NOT NULL THEN
      IF new_using ~* 'auth\.' THEN
        new_using := regexp_replace(
          new_using,
          '(?<!SELECT\s)auth\.([a-zA-Z0-9_]+)\(\)',
          '(SELECT auth.\1())',
          'gi'
        );
      END IF;
      IF new_using ~* 'current_setting\s*\(' THEN
        new_using := regexp_replace(
          new_using,
          '(?<!SELECT\s)(current_setting\([^)]*\))',
          '(SELECT \1)',
          'gi'
        );
      END IF;
      changed := changed OR new_using IS DISTINCT FROM rec.using_expr;
    END IF;

    IF new_check IS NOT NULL THEN
      IF new_check ~* 'auth\.' THEN
        new_check := regexp_replace(
          new_check,
          '(?<!SELECT\s)auth\.([a-zA-Z0-9_]+)\(\)',
          '(SELECT auth.\1())',
          'gi'
        );
      END IF;
      IF new_check ~* 'current_setting\s*\(' THEN
        new_check := regexp_replace(
          new_check,
          '(?<!SELECT\s)(current_setting\([^)]*\))',
          '(SELECT \1)',
          'gi'
        );
      END IF;
      changed := changed OR new_check IS DISTINCT FROM rec.check_expr;
    END IF;

    IF changed THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I %s',
        rec.policyname,
        rec.schemaname,
        rec.tablename,
        concat_ws(
          ' ',
          CASE WHEN new_using IS NOT NULL THEN format('USING (%s)', new_using) END,
          CASE WHEN new_check IS NOT NULL THEN format('WITH CHECK (%s)', new_check) END
        )
      );
    END IF;
  END LOOP;
END $$;
