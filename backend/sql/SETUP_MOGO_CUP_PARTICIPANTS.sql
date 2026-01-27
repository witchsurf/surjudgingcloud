-- ============================================================================
-- SETUP COMPLET MOGO CUP avec participants et heats
-- ============================================================================

BEGIN;

-- 1. Trouver ou créer l'event MOGO CUP
DO $$
DECLARE
  v_event_id BIGINT;
  v_user_id UUID;
BEGIN
  -- Récupérer le user_id actuel
  SELECT auth.uid() INTO v_user_id;

  -- Chercher si MOGO CUP existe déjà
  SELECT id INTO v_event_id
  FROM events
  WHERE name = 'MOGO CUP'
  LIMIT 1;

  -- Si pas trouvé, le créer
  IF v_event_id IS NULL THEN
    INSERT INTO events (
      name,
      organizer,
      location,
      start_date,
      end_date,
      user_id,
      paid,
      created_at
    ) VALUES (
      'MOGO CUP',
      'Organizer',
      'Location',
      CURRENT_DATE,
      CURRENT_DATE + INTERVAL '2 days',
      v_user_id,
      true,
      NOW()
    )
    RETURNING id INTO v_event_id;

    RAISE NOTICE 'Created MOGO CUP event with ID: %', v_event_id;
  ELSE
    RAISE NOTICE 'Found existing MOGO CUP event with ID: %', v_event_id;
  END IF;

  -- Supprimer les anciennes données pour repartir à zéro
  DELETE FROM heat_entries WHERE heat_id IN (
    SELECT id FROM heats WHERE event_id = v_event_id
  );
  DELETE FROM heat_slot_mappings WHERE heat_id IN (
    SELECT id FROM heats WHERE event_id = v_event_id
  );
  DELETE FROM heat_realtime_config WHERE heat_id IN (
    SELECT id FROM heats WHERE event_id = v_event_id
  );
  DELETE FROM heats WHERE event_id = v_event_id;
  DELETE FROM participants WHERE event_id = v_event_id;

  RAISE NOTICE 'Cleaned up old data for event %', v_event_id;

  -- Insérer les participants pour la catégorie junior (12 participants)
  INSERT INTO participants (event_id, category, seed, name, country, license, created_at, updated_at)
  VALUES
    (v_event_id, 'junior', 1, 'Alice MARTIN', 'FRANCE', 'LIC001', NOW(), NOW()),
    (v_event_id, 'junior', 2, 'Bob DUPONT', 'SENEGAL', 'LIC002', NOW(), NOW()),
    (v_event_id, 'junior', 3, 'Charlie BERNARD', 'GABON', 'LIC003', NOW(), NOW()),
    (v_event_id, 'junior', 4, 'Diana LEFEBVRE', 'MAROC', 'LIC004', NOW(), NOW()),
    (v_event_id, 'junior', 5, 'Emma ROUSSEAU', 'FRANCE', 'LIC005', NOW(), NOW()),
    (v_event_id, 'junior', 6, 'Frank MOREAU', 'SENEGAL', 'LIC006', NOW(), NOW()),
    (v_event_id, 'junior', 7, 'Grace LAURENT', 'GABON', 'LIC007', NOW(), NOW()),
    (v_event_id, 'junior', 8, 'Hugo SIMON', 'MAROC', 'LIC008', NOW(), NOW()),
    (v_event_id, 'junior', 9, 'Iris MICHEL', 'FRANCE', 'LIC009', NOW(), NOW()),
    (v_event_id, 'junior', 10, 'Jack GARCIA', 'SENEGAL', 'LIC010', NOW(), NOW()),
    (v_event_id, 'junior', 11, 'Kate THOMAS', 'GABON', 'LIC011', NOW(), NOW()),
    (v_event_id, 'junior', 12, 'Leo ROBERT', 'MAROC', 'LIC012', NOW(), NOW());

  RAISE NOTICE 'Inserted 12 junior participants';

  -- Créer les heats pour Round 1 (4 heats de 3 participants)
  INSERT INTO heats (id, competition, division, round, heat_number, status, event_id, created_at, updated_at, heat_size, color_order, is_active)
  VALUES
    ('MOGO_CUP_junior_R1_H1', 'MOGO CUP', 'junior', 1, 1, 'open', v_event_id, NOW(), NOW(), 3, ARRAY['RED', 'WHITE', 'YELLOW'], true),
    ('MOGO_CUP_junior_R1_H2', 'MOGO CUP', 'junior', 1, 2, 'open', v_event_id, NOW(), NOW(), 3, ARRAY['RED', 'WHITE', 'YELLOW'], true),
    ('MOGO_CUP_junior_R1_H3', 'MOGO CUP', 'junior', 1, 3, 'open', v_event_id, NOW(), NOW(), 3, ARRAY['RED', 'WHITE', 'YELLOW'], true),
    ('MOGO_CUP_junior_R1_H4', 'MOGO CUP', 'junior', 1, 4, 'open', v_event_id, NOW(), NOW(), 3, ARRAY['RED', 'WHITE', 'YELLOW'], true);

  RAISE NOTICE 'Created 4 heats for Round 1';

  -- Créer les heat_entries en associant les participants aux heats
  -- Heat 1: Seeds 1, 2, 3
  INSERT INTO heat_entries (heat_id, participant_id, position, seed, color, created_at)
  SELECT 'MOGO_CUP_junior_R1_H1', p.id,
    CASE p.seed
      WHEN 1 THEN 1
      WHEN 2 THEN 2
      WHEN 3 THEN 3
    END,
    p.seed,
    CASE p.seed
      WHEN 1 THEN 'RED'
      WHEN 2 THEN 'WHITE'
      WHEN 3 THEN 'YELLOW'
    END,
    NOW()
  FROM participants p
  WHERE p.event_id = v_event_id AND p.category = 'junior' AND p.seed IN (1, 2, 3);

  -- Heat 2: Seeds 4, 5, 6
  INSERT INTO heat_entries (heat_id, participant_id, position, seed, color, created_at)
  SELECT 'MOGO_CUP_junior_R1_H2', p.id,
    CASE p.seed
      WHEN 4 THEN 1
      WHEN 5 THEN 2
      WHEN 6 THEN 3
    END,
    p.seed,
    CASE p.seed
      WHEN 4 THEN 'RED'
      WHEN 5 THEN 'WHITE'
      WHEN 6 THEN 'YELLOW'
    END,
    NOW()
  FROM participants p
  WHERE p.event_id = v_event_id AND p.category = 'junior' AND p.seed IN (4, 5, 6);

  -- Heat 3: Seeds 7, 8, 9
  INSERT INTO heat_entries (heat_id, participant_id, position, seed, color, created_at)
  SELECT 'MOGO_CUP_junior_R1_H3', p.id,
    CASE p.seed
      WHEN 7 THEN 1
      WHEN 8 THEN 2
      WHEN 9 THEN 3
    END,
    p.seed,
    CASE p.seed
      WHEN 7 THEN 'RED'
      WHEN 8 THEN 'WHITE'
      WHEN 9 THEN 'YELLOW'
    END,
    NOW()
  FROM participants p
  WHERE p.event_id = v_event_id AND p.category = 'junior' AND p.seed IN (7, 8, 9);

  -- Heat 4: Seeds 10, 11, 12
  INSERT INTO heat_entries (heat_id, participant_id, position, seed, color, created_at)
  SELECT 'MOGO_CUP_junior_R1_H4', p.id,
    CASE p.seed
      WHEN 10 THEN 1
      WHEN 11 THEN 2
      WHEN 12 THEN 3
    END,
    p.seed,
    CASE p.seed
      WHEN 10 THEN 'RED'
      WHEN 11 THEN 'WHITE'
      WHEN 12 THEN 'YELLOW'
    END,
    NOW()
  FROM participants p
  WHERE p.event_id = v_event_id AND p.category = 'junior' AND p.seed IN (10, 11, 12);

  RAISE NOTICE 'Created heat_entries for all heats';

  -- Créer les heat_slot_mappings
  INSERT INTO heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position, created_at)
  VALUES
    ('MOGO_CUP_junior_R1_H1', 1, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H1', 2, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H1', 3, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H2', 1, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H2', 2, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H2', 3, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H3', 1, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H3', 2, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H3', 3, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H4', 1, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H4', 2, NULL, NULL, NULL, NULL, NOW()),
    ('MOGO_CUP_junior_R1_H4', 3, NULL, NULL, NULL, NULL, NOW());

  -- Créer les heat_realtime_config
  INSERT INTO heat_realtime_config (heat_id, status, timer_start_time, timer_duration_minutes, config_data, updated_at, updated_by)
  VALUES
    ('MOGO_CUP_junior_R1_H1', 'waiting', NULL, 20, '{}', NOW(), 'system'),
    ('MOGO_CUP_junior_R1_H2', 'waiting', NULL, 20, '{}', NOW(), 'system'),
    ('MOGO_CUP_junior_R1_H3', 'waiting', NULL, 20, '{}', NOW(), 'system'),
    ('MOGO_CUP_junior_R1_H4', 'waiting', NULL, 20, '{}', NOW(), 'system');

  RAISE NOTICE 'Setup complete!';
END $$;

COMMIT;

-- Vérification finale
SELECT 'Event MOGO CUP' as item, COUNT(*) as count FROM events WHERE name = 'MOGO CUP'
UNION ALL
SELECT 'Participants junior' as item, COUNT(*) as count FROM participants p JOIN events e ON e.id = p.event_id WHERE e.name = 'MOGO CUP' AND p.category = 'junior'
UNION ALL
SELECT 'Heats' as item, COUNT(*) as count FROM heats WHERE competition = 'MOGO CUP'
UNION ALL
SELECT 'Heat entries' as item, COUNT(*) as count FROM heat_entries WHERE heat_id LIKE 'MOGO_CUP_%';

-- Afficher les participants et leurs affectations
SELECT
    h.id as heat_id,
    h.round,
    h.heat_number,
    he.position,
    he.color,
    p.seed,
    p.name,
    p.country
FROM heats h
JOIN heat_entries he ON he.heat_id = h.id
JOIN participants p ON p.id = he.participant_id
WHERE h.competition = 'MOGO CUP'
ORDER BY h.round, h.heat_number, he.position;
