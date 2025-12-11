-- ============================================================================
-- Vérifier que les RLS policies permettent la lecture des participants
-- ============================================================================

-- 1. Vérifier les policies actuelles
SELECT
    tablename,
    policyname,
    permissive,
    roles::text[] as allowed_roles,
    cmd as command,
    qual as using_expression
FROM pg_policies
WHERE tablename IN ('participants', 'heat_entries')
  AND cmd = 'SELECT'
ORDER BY tablename, policyname;

-- 2. Tester en tant que rôle ANON (ce que le navigateur utilise)
SET ROLE anon;

-- Test 1: Peut-on lire les participants ?
SELECT COUNT(*) as participant_count, 'Participants visible by anon?' as test
FROM participants
WHERE event_id IN (SELECT id FROM events WHERE name = 'MOGO CUP');

-- Test 2: Peut-on lire les heat_entries ?
SELECT COUNT(*) as entry_count, 'Heat entries visible by anon?' as test
FROM heat_entries
WHERE heat_id LIKE 'MOGO_CUP_%';

-- Test 3: Le JOIN fonctionne-t-il ?
SELECT
    he.heat_id,
    he.color,
    he.position,
    p.name as participant_name,
    p.country
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id = 'MOGO_CUP_junior_R1_H1'
ORDER BY he.position;

RESET ROLE;

-- 4. Afficher le résultat
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_policies
            WHERE tablename = 'participants'
            AND cmd = 'SELECT'
            AND policyname LIKE '%public%'
        ) THEN '✅ Policy publique trouvée pour participants'
        ELSE '❌ Aucune policy publique pour participants - EXÉCUTEZ FIX_PARTICIPANT_NAMES_NOW.sql'
    END as status;
