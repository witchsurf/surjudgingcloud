-- ============================================================================
-- DIAGNOSTIC: Why participant names don't show in public display
-- ============================================================================
-- Run this in Supabase SQL Editor to diagnose the issue

-- 1. Test if the foreign key exists
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name='heat_entries'
  AND kcu.column_name = 'participant_id';

-- 2. Check what columns exist in heat_entries
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'heat_entries'
ORDER BY ordinal_position;

-- 3. Test the actual JOIN query (with anon role to simulate public display)
SET ROLE anon;

SELECT
    he.color,
    he.position,
    he.participant_id,
    he.seed,
    p.name as participant_name,
    p.country as participant_country,
    p.license as participant_license
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id = 'laraise_cup_cadet_r1_h1'
ORDER BY he.position ASC;

-- Reset role
RESET ROLE;

-- 4. Check if v_heat_lineup view exists and works
SELECT * FROM pg_views WHERE viewname = 'v_heat_lineup';

-- 5. Test the v_heat_lineup query
SELECT
    heat_id,
    jersey_color,
    surfer_name,
    country,
    seed,
    position
FROM v_heat_lineup
WHERE heat_id = 'laraise_cup_cadet_r1_h1'
ORDER BY position ASC;

-- 6. Check RLS policies on both tables
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles::text[],
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename IN ('participants', 'heat_entries')
ORDER BY tablename, policyname;

-- 7. Verify the participant data exists
SELECT
    p.id,
    p.event_id,
    p.name,
    p.category,
    p.seed
FROM participants p
WHERE p.id IN (
    SELECT participant_id
    FROM heat_entries
    WHERE heat_id LIKE 'laraise_cup_cadet%'
)
ORDER BY p.seed;

-- 8. Check if there are any NULL participant_ids
SELECT
    heat_id,
    position,
    participant_id,
    seed,
    color,
    CASE
        WHEN participant_id IS NULL THEN '❌ NULL participant_id'
        ELSE '✅ Has participant_id'
    END as status
FROM heat_entries
WHERE heat_id LIKE 'laraise_cup_cadet%'
ORDER BY heat_id, position;
