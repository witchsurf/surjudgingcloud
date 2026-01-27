-- ============================================================================
-- FIX RPC PERMISSIONS: Grant Execute on All RPC Functions
-- ============================================================================
-- The 401 Unauthorized error happens when calling RPC functions
-- This grants public execute permissions on our RPC functions
-- ============================================================================

BEGIN;

-- Grant execute on bulk_upsert_heats to EVERYONE (public + authenticated)
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO public;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO anon;

-- Grant execute on bulk_upsert_heats_secure to EVERYONE
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats_secure(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO public;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats_secure(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_heats_secure(JSONB,JSONB,JSONB,JSONB,TEXT[]) TO anon;

-- Grant execute on upsert_event_last_config (if it exists)
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(BIGINT,TEXT,TEXT,INT,INT,JSONB) TO public;
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(BIGINT,TEXT,TEXT,INT,INT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_event_last_config(BIGINT,TEXT,TEXT,INT,INT,JSONB) TO anon;

COMMIT;

SELECT '✅ RPC PERMISSIONS GRANTED' AS status;

-- Verify permissions
SELECT
  routine_name,
  routine_type,
  security_type,
  CASE
    WHEN proacl::text LIKE '%=X%' THEN '✅ PUBLIC CAN EXECUTE'
    ELSE '❌ RESTRICTED'
  END as access_level
FROM information_schema.routines r
LEFT JOIN pg_proc p ON r.specific_name = p.proname || '_' || p.oid
WHERE routine_schema = 'public'
  AND routine_name IN ('bulk_upsert_heats', 'bulk_upsert_heats_secure', 'upsert_event_last_config')
ORDER BY routine_name;

-- Alternative check using pg_proc
SELECT
  proname as function_name,
  proacl as permissions
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname LIKE '%bulk_upsert%'
ORDER BY proname;
