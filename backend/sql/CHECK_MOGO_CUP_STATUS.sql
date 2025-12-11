-- ============================================================================
-- Vérifier l'état de MOGO CUP
-- ============================================================================

-- 1. Trouver l'event MOGO CUP
SELECT
    id,
    name,
    organizer,
    location,
    start_date,
    created_at
FROM events
WHERE name ILIKE '%MOGO%'
ORDER BY created_at DESC;

-- 2. Trouver tous les events récents
SELECT
    id,
    name,
    organizer,
    created_at
FROM events
ORDER BY created_at DESC
LIMIT 10;

-- 3. Pour MOGO CUP, quels heats existent ?
SELECT
    h.id,
    h.competition,
    h.division,
    h.round,
    h.heat_number,
    h.event_id,
    h.status,
    COUNT(he.id) as heat_entries_count
FROM heats h
LEFT JOIN heat_entries he ON he.heat_id = h.id
WHERE h.competition ILIKE '%MOGO%'
GROUP BY h.id, h.competition, h.division, h.round, h.heat_number, h.event_id, h.status
ORDER BY h.round, h.heat_number;

-- 4. Quels participants existent pour MOGO CUP ?
SELECT
    p.id,
    p.event_id,
    p.category,
    p.seed,
    p.name,
    p.country
FROM participants p
JOIN events e ON e.id = p.event_id
WHERE e.name ILIKE '%MOGO%'
ORDER BY p.category, p.seed
LIMIT 50;

-- 5. Compter les participants par catégorie
SELECT
    e.name as event_name,
    p.category,
    COUNT(*) as participant_count
FROM participants p
JOIN events e ON e.id = p.event_id
WHERE e.name ILIKE '%MOGO%'
GROUP BY e.name, p.category
ORDER BY p.category;
