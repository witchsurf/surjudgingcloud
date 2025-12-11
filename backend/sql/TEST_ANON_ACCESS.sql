-- ============================================================================
-- TEST: What does the ANON role see?
-- ============================================================================

-- 1. Test as ANON role (this is what the browser uses)
SET ROLE anon;

-- 2. Can anon read participants directly?
SELECT
    id,
    name,
    category,
    seed,
    event_id
FROM participants
WHERE id IN (246, 247, 248, 249, 250, 251)
ORDER BY seed;

-- 3. Can anon read heat_entries?
SELECT
    heat_id,
    position,
    participant_id,
    seed,
    color
FROM heat_entries
WHERE heat_id = 'laraise_cup_cadet_r1_h1'
ORDER BY position;

-- 4. Can anon do the JOIN? (This is what the app tries to do)
SELECT
    he.color,
    he.position,
    he.participant_id,
    he.seed,
    p.name as participant_name,
    p.country as participant_country
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id = 'laraise_cup_cadet_r1_h1'
ORDER BY he.position ASC;

-- 5. Reset role
RESET ROLE;

-- 6. Now test as authenticated (logged in user)
SET ROLE authenticated;

SELECT
    he.color,
    he.position,
    he.participant_id,
    he.seed,
    p.name as participant_name,
    p.country as participant_country
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id = 'laraise_cup_cadet_r1_h1'
ORDER BY he.position ASC;

RESET ROLE;

-- 7. Check what the current auth.role() returns
SELECT auth.role() as current_role;

-- 8. Check the exact policy on participants for SELECT
SELECT
    policyname,
    roles::text[],
    qual as using_expression,
    permissive
FROM pg_policies
WHERE tablename = 'participants' AND cmd = 'SELECT';
