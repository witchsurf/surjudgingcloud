-- ============================================================================
-- REBUILD_DIVISION_QUALIFIERS_FROM_SCORES.sql
-- ============================================================================
-- Recalcule les qualifiés d'une division à partir des scores réels
-- et réécrit les slots mappés (heat_slot_mappings) dans les rounds suivants.
--
-- Cas d'usage:
-- - Qualifiés propagés dans de mauvais slots / mauvaise logique précédente
-- - Bouton UI "Recalculer qualifiés" insuffisant ou état incohérent
-- - Mappings incomplets (source_round/source_heat/source_position NULL mais placeholder présent)
--
-- IMPORTANT:
-- 1) Ajuster v_event_name et v_division
-- 2) Script idempotent: peut être rejoué
-- 3) Ne touche qu'à la division ciblée
-- ============================================================================

DO $$
DECLARE
  v_event_name text := 'test off line';   -- <-- A ADAPTER
  v_division text := 'ONDINE U16';        -- <-- A ADAPTER
  v_event_id bigint;
  v_updated integer := 0;
BEGIN
  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE lower(e.name) = lower(v_event_name)
  ORDER BY e.id DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Event "%" introuvable', v_event_name;
  END IF;

  WITH source_heats AS (
    SELECT h.id, h.round, h.heat_number
    FROM public.heats h
    WHERE h.event_id = v_event_id
      AND upper(trim(h.division)) = upper(trim(v_division))
  ),
  mapping_with_source AS (
    SELECT
      hm.heat_id,
      hm.position,
      hm.placeholder,
      COALESCE(
        hm.source_round,
        (
          CASE
            WHEN hm.placeholder ~* 'R(P?)[0-9]+-H[0-9]+.*P[0-9]+' THEN
              (regexp_match(upper(hm.placeholder), 'R(P?)([0-9]+)-H([0-9]+).*P([0-9]+)'))[2]::int
            ELSE NULL
          END
        )
      ) AS source_round,
      COALESCE(
        hm.source_heat,
        (
          CASE
            WHEN hm.placeholder ~* 'R(P?)[0-9]+-H[0-9]+.*P[0-9]+' THEN
              (regexp_match(upper(hm.placeholder), 'R(P?)([0-9]+)-H([0-9]+).*P([0-9]+)'))[3]::int
            ELSE NULL
          END
        )
      ) AS source_heat,
      COALESCE(
        hm.source_position,
        (
          CASE
            WHEN hm.placeholder ~* 'R(P?)[0-9]+-H[0-9]+.*P[0-9]+' THEN
              (regexp_match(upper(hm.placeholder), 'R(P?)([0-9]+)-H([0-9]+).*P([0-9]+)'))[4]::int
            ELSE NULL
          END
        )
      ) AS source_position
    FROM public.heat_slot_mappings hm
  ),
  -- Normalise les couleurs (FR/EN) pour matcher scores.surfer <-> heat_entries.color
  score_wave_avg AS (
    SELECT
      s.heat_id,
      CASE
        WHEN upper(trim(s.surfer)) IN ('RED', 'ROUGE') THEN 'RED'
        WHEN upper(trim(s.surfer)) IN ('WHITE', 'BLANC') THEN 'WHITE'
        WHEN upper(trim(s.surfer)) IN ('YELLOW', 'JAUNE') THEN 'YELLOW'
        WHEN upper(trim(s.surfer)) IN ('BLUE', 'BLEU') THEN 'BLUE'
        WHEN upper(trim(s.surfer)) IN ('GREEN', 'VERT') THEN 'GREEN'
        WHEN upper(trim(s.surfer)) IN ('BLACK', 'NOIR') THEN 'BLACK'
        ELSE upper(trim(s.surfer))
      END AS surfer_color,
      s.wave_number,
      AVG(s.score)::numeric AS wave_avg
    FROM public.scores s
    JOIN source_heats sh ON sh.id = s.heat_id
    WHERE s.score > 0
    GROUP BY s.heat_id, 2, s.wave_number
  ),
  best_two AS (
    SELECT
      x.heat_id,
      x.surfer_color,
      SUM(x.wave_avg)::numeric AS best_two
    FROM (
      SELECT
        swa.*,
        ROW_NUMBER() OVER (
          PARTITION BY swa.heat_id, swa.surfer_color
          ORDER BY swa.wave_avg DESC, swa.wave_number ASC
        ) AS rn
      FROM score_wave_avg swa
    ) x
    WHERE x.rn <= 2
    GROUP BY x.heat_id, x.surfer_color
  ),
  ranked AS (
    SELECT
      b.heat_id,
      b.surfer_color,
      b.best_two,
      DENSE_RANK() OVER (
        PARTITION BY b.heat_id
        ORDER BY b.best_two DESC, b.surfer_color ASC
      ) AS rank_pos
    FROM best_two b
  ),
  source_entry_by_rank AS (
    SELECT
      r.heat_id,
      r.rank_pos,
      he.participant_id,
      he.seed,
      he.color
    FROM ranked r
    JOIN public.heat_entries he
      ON he.heat_id = r.heat_id
     AND (
       CASE
         WHEN upper(trim(coalesce(he.color, ''))) IN ('RED', 'ROUGE') THEN 'RED'
         WHEN upper(trim(coalesce(he.color, ''))) IN ('WHITE', 'BLANC') THEN 'WHITE'
         WHEN upper(trim(coalesce(he.color, ''))) IN ('YELLOW', 'JAUNE') THEN 'YELLOW'
         WHEN upper(trim(coalesce(he.color, ''))) IN ('BLUE', 'BLEU') THEN 'BLUE'
         WHEN upper(trim(coalesce(he.color, ''))) IN ('GREEN', 'VERT') THEN 'GREEN'
         WHEN upper(trim(coalesce(he.color, ''))) IN ('BLACK', 'NOIR') THEN 'BLACK'
         ELSE upper(trim(coalesce(he.color, '')))
       END
     ) = r.surfer_color
    JOIN public.participants p ON p.id = he.participant_id
    WHERE upper(trim(coalesce(p.category, ''))) = upper(trim(v_division))
  ),
  target_slots AS (
    SELECT
      th.id AS target_heat_id,
      mws.position AS target_position,
      mws.source_round,
      mws.source_heat,
      mws.source_position,
      she.id AS source_heat_id,
      COALESCE(
        th.color_order[mws.position],
        CASE mws.position
          WHEN 1 THEN 'RED'
          WHEN 2 THEN 'WHITE'
          WHEN 3 THEN 'YELLOW'
          WHEN 4 THEN 'BLUE'
          WHEN 5 THEN 'GREEN'
          WHEN 6 THEN 'BLACK'
          ELSE NULL
        END
      ) AS target_color
    FROM public.heats th
    JOIN mapping_with_source mws ON mws.heat_id = th.id
    JOIN public.heats she
      ON she.event_id = th.event_id
     AND upper(trim(she.division)) = upper(trim(th.division))
     AND she.round = mws.source_round
     AND she.heat_number = mws.source_heat
    WHERE th.event_id = v_event_id
      AND upper(trim(th.division)) = upper(trim(v_division))
      AND mws.source_round IS NOT NULL
      AND mws.source_heat IS NOT NULL
      AND mws.source_position IS NOT NULL
  ),
  rebuild_rows AS (
    SELECT
      ts.target_heat_id,
      ts.target_position,
      sr.participant_id,
      sr.seed,
      ts.target_color
    FROM target_slots ts
    LEFT JOIN source_entry_by_rank sr
      ON sr.heat_id = ts.source_heat_id
     AND sr.rank_pos = ts.source_position
  ),
  applied AS (
    UPDATE public.heat_entries he
    SET
      participant_id = rr.participant_id,
      seed = COALESCE(rr.seed, he.seed, he.position),
      color = COALESCE(rr.target_color, he.color)
    FROM rebuild_rows rr
    WHERE he.heat_id = rr.target_heat_id
      AND he.position = rr.target_position
    RETURNING he.heat_id, he.position
  )
  SELECT count(*) INTO v_updated FROM applied;

  RAISE NOTICE '✅ Event ID: %, division: %, slots recalculés: %', v_event_id, v_division, v_updated;
END $$;

-- Vérification rapide après rebuild
SELECT
  h.division,
  h.round,
  h.heat_number,
  he.position,
  he.color,
  he.seed,
  p.name AS participant_name,
  p.category AS participant_category
FROM public.heats h
JOIN public.heat_entries he ON he.heat_id = h.id
LEFT JOIN public.participants p ON p.id = he.participant_id
WHERE lower(h.competition) = lower('test off line')   -- <-- A ADAPTER
  AND upper(trim(h.division)) = upper(trim('ONDINE U16')) -- <-- A ADAPTER
ORDER BY h.round, h.heat_number, he.position;

-- Vérification: aucune affectation cross-division ne doit rester
SELECT
  h.id AS heat_id,
  h.division AS heat_division,
  h.round,
  h.heat_number,
  he.position,
  he.color,
  p.name AS participant_name,
  p.category AS participant_category
FROM public.heat_entries he
JOIN public.heats h ON h.id = he.heat_id
JOIN public.participants p ON p.id = he.participant_id
WHERE lower(h.competition) = lower('test off line') -- <-- A ADAPTER
  AND upper(trim(coalesce(h.division, ''))) <> upper(trim(coalesce(p.category, '')))
ORDER BY h.division, h.round, h.heat_number, he.position;
