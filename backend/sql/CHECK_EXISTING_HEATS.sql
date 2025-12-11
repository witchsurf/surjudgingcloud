-- ============================================================================
-- Vérifier quels heats existent et lesquels ont des participants
-- ============================================================================

-- 1. Liste tous les heats
SELECT
    id,
    competition,
    division,
    round,
    heat_number,
    event_id,
    status
FROM heats
ORDER BY created_at DESC
LIMIT 20;

-- 2. Pour chaque heat, combien de heat_entries ?
SELECT
    h.id as heat_id,
    h.competition,
    h.division,
    h.round,
    h.heat_number,
    COUNT(he.id) as entry_count,
    COUNT(CASE WHEN he.participant_id IS NOT NULL THEN 1 END) as with_participant_id
FROM heats h
LEFT JOIN heat_entries he ON he.heat_id = h.id
GROUP BY h.id, h.competition, h.division, h.round, h.heat_number
ORDER BY h.created_at DESC
LIMIT 20;

-- 3. Vérifier spécifiquement MOGO_CUP_junior_R1_H1
SELECT
    'Heat exists?' as check_type,
    COUNT(*) as result
FROM heats
WHERE id = 'MOGO_CUP_junior_R1_H1';

-- 4. Y a-t-il des heat_entries pour MOGO_CUP_junior_R1_H1 ?
SELECT
    'heat_entries for MOGO_CUP_junior?' as check_type,
    COUNT(*) as result
FROM heat_entries
WHERE heat_id = 'MOGO_CUP_junior_R1_H1';

-- 5. Y a-t-il des participants pour l'event_id de MOGO CUP ?
SELECT
    e.id as event_id,
    e.name as event_name,
    COUNT(p.id) as participant_count
FROM events e
LEFT JOIN participants p ON p.event_id = e.id
WHERE e.name LIKE '%MOGO%' OR e.name LIKE '%mogo%'
GROUP BY e.id, e.name;

-- 6. Montrer tous les events disponibles
SELECT
    id,
    name,
    organizer,
    created_at
FROM events
ORDER BY created_at DESC
LIMIT 10;
