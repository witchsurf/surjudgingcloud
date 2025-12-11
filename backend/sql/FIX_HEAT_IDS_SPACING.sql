-- ============================================================================
-- CORRIGER LES HEAT_IDS : enlever underscores, utiliser espaces
-- ============================================================================

BEGIN;

-- 1. Mettre à jour les heat_ids dans toutes les tables dépendantes
UPDATE heat_realtime_config
SET heat_id = REPLACE(heat_id, 'MOGO_CUP', 'MOGO CUP')
WHERE heat_id LIKE 'MOGO_CUP%';

UPDATE heat_slot_mappings
SET heat_id = REPLACE(heat_id, 'MOGO_CUP', 'MOGO CUP')
WHERE heat_id LIKE 'MOGO_CUP%';

UPDATE heat_entries
SET heat_id = REPLACE(heat_id, 'MOGO_CUP', 'MOGO CUP')
WHERE heat_id LIKE 'MOGO_CUP%';

UPDATE scores
SET heat_id = REPLACE(heat_id, 'MOGO_CUP', 'MOGO CUP')
WHERE heat_id LIKE 'MOGO_CUP%';

-- 2. Enfin, mettre à jour la table heats
UPDATE heats
SET id = REPLACE(id, 'MOGO_CUP', 'MOGO CUP'),
    competition = 'MOGO CUP'
WHERE id LIKE 'MOGO_CUP%';

COMMIT;

-- 3. Vérifier que ça a fonctionné
SELECT 'Heats après correction:' as check;
SELECT id, competition, division, round, heat_number
FROM heats
WHERE competition = 'MOGO CUP'
ORDER BY round, heat_number;

SELECT 'Heat entries après correction:' as check;
SELECT he.heat_id, he.position, he.color, p.name
FROM heat_entries he
JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id LIKE 'MOGO CUP%'
ORDER BY he.heat_id, he.position
LIMIT 10;

-- 4. Test du JOIN avec le nouveau heat_id
SET ROLE anon;

SELECT
    'TEST ANON avec nouveau heat_id:' as test,
    he.heat_id,
    he.color,
    he.position,
    p.name as participant_name
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id = 'MOGO CUP_junior_R1_H1'
ORDER BY he.position;

RESET ROLE;

SELECT '✅ Correction terminée! Les heat_ids utilisent maintenant des espaces.' as status;
