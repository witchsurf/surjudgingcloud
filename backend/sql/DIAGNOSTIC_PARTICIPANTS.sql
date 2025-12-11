-- ============================================================================
-- DIAGNOSTIC: Vérifier la cohérence des IDs
-- ============================================================================

-- 1. Vérifier quel événement a quel ID
SELECT id, name, organizer, created_at
FROM events
ORDER BY created_at DESC
LIMIT 5;

-- 2. Compter les participants par event_id
SELECT event_id, COUNT(*) as participant_count
FROM participants
GROUP BY event_id
ORDER BY event_id;

-- 3. Vérifier les participants pour event_id 38
SELECT id, seed, name, category
FROM participants
WHERE event_id = 38
ORDER BY seed;

-- 4. Vérifier les heat_entries et leurs références
SELECT
  he.heat_id,
  he.participant_id,
  he.seed,
  he.color,
  p.id as actual_participant_id,
  p.name as participant_name,
  p.event_id as participant_event_id
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id LIKE '%laraise_cup%'
ORDER BY he.heat_id, he.position;

-- 5. Identifier les heat_entries orphelins (sans participant)
SELECT
  he.heat_id,
  he.participant_id,
  he.seed,
  CASE
    WHEN p.id IS NULL THEN '❌ ORPHELIN - Participant n''existe pas'
    WHEN p.event_id != h.event_id THEN '⚠️ MAUVAIS EVENT'
    ELSE '✅ OK'
  END as status
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
LEFT JOIN heats h ON h.id = he.heat_id
WHERE he.heat_id LIKE '%laraise_cup%'
ORDER BY he.heat_id, he.position;

-- 6. Vérifier la correspondance seed → participant_id pour event 38
SELECT
  he.seed,
  he.participant_id as heat_entry_participant_id,
  p.id as actual_participant_id,
  p.name,
  p.event_id
FROM heat_entries he
LEFT JOIN participants p ON p.seed = he.seed AND p.event_id = 38 AND p.category = 'CADET'
WHERE he.heat_id LIKE '%laraise_cup_cadet%'
ORDER BY he.seed;
