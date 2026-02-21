-- ============================================================================
-- FIX_WRONG_DIVISION_ASSIGNMENTS.sql
-- ============================================================================
-- But: corriger les affectations de participants dans une mauvaise division
-- (ex: participant catégorie MINIME placé dans un heat division ONDINE U16).
--
-- Effet:
-- 1) Détecte les lignes incohentes heat_entries vs participants.category
-- 2) Supprime seulement participant_id sur ces lignes (placeholder conservé)
-- 3) Laisse les données cohérentes intactes
--
-- IMPORTANT:
-- - Ajuster v_event_name avant exécution
-- - Ce script est idempotent (rejouable sans effet secondaire)
-- ============================================================================

DO $$
DECLARE
  v_event_name text := 'test off line'; -- <-- A ADAPTER
  v_event_id bigint;
  v_before_count integer := 0;
  v_after_count integer := 0;
BEGIN
  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE lower(e.name) = lower(v_event_name)
  ORDER BY e.id DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Event "%" introuvable', v_event_name;
  END IF;

  -- Comptage avant correction
  SELECT count(*)
  INTO v_before_count
  FROM public.heat_entries he
  JOIN public.heats h ON h.id = he.heat_id
  JOIN public.participants p ON p.id = he.participant_id
  WHERE h.event_id = v_event_id
    AND upper(trim(coalesce(p.category, ''))) <> upper(trim(coalesce(h.division, '')));

  RAISE NOTICE 'Event ID: %, incohérences avant fix: %', v_event_id, v_before_count;

  -- Correction: on vide seulement participant_id quand category != division.
  UPDATE public.heat_entries he
  SET participant_id = NULL
  FROM public.heats h, public.participants p
  WHERE h.id = he.heat_id
    AND p.id = he.participant_id
    AND h.event_id = v_event_id
    AND upper(trim(coalesce(p.category, ''))) <> upper(trim(coalesce(h.division, '')));

  -- Comptage après correction
  SELECT count(*)
  INTO v_after_count
  FROM public.heat_entries he
  JOIN public.heats h ON h.id = he.heat_id
  JOIN public.participants p ON p.id = he.participant_id
  WHERE h.event_id = v_event_id
    AND upper(trim(coalesce(p.category, ''))) <> upper(trim(coalesce(h.division, '')));

  RAISE NOTICE 'Incohérences après fix: %', v_after_count;
  RAISE NOTICE '✅ Correction terminée. Rejouer ensuite le calcul de qualifiés pour les heats impactés.';
END $$;

-- Vérification détaillée (post-fix)
SELECT
  h.id AS heat_id,
  h.division AS heat_division,
  he.position,
  he.color,
  he.seed,
  p.name AS participant_name,
  p.category AS participant_category
FROM public.heat_entries he
JOIN public.heats h ON h.id = he.heat_id
LEFT JOIN public.participants p ON p.id = he.participant_id
WHERE lower(h.competition) = lower('test off line') -- <-- A ADAPTER si besoin
ORDER BY h.division, h.round, h.heat_number, he.position;
