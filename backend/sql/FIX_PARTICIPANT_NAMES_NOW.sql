-- ============================================================================
-- FIX IMMÉDIAT: Rendre les noms des participants visibles
-- À exécuter directement dans Supabase SQL Editor
-- ============================================================================

BEGIN;

-- 1. Drop les anciennes policies restrictives
DROP POLICY IF EXISTS participants_select ON public.participants;
DROP POLICY IF EXISTS participants_insert ON public.participants;
DROP POLICY IF EXISTS participants_update ON public.participants;
DROP POLICY IF EXISTS participants_delete ON public.participants;

DROP POLICY IF EXISTS heat_entries_select ON public.heat_entries;
DROP POLICY IF EXISTS heat_entries_insert ON public.heat_entries;
DROP POLICY IF EXISTS heat_entries_update ON public.heat_entries;
DROP POLICY IF EXISTS heat_entries_delete ON public.heat_entries;

-- 2. Créer des policies publiques pour la lecture (les noms sont publics dans une compétition)
CREATE POLICY participants_public_read ON public.participants
  FOR SELECT
  USING (true);

CREATE POLICY participants_auth_write ON public.participants
  FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY heat_entries_public_read ON public.heat_entries
  FOR SELECT
  USING (true);

CREATE POLICY heat_entries_auth_write ON public.heat_entries
  FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- 3. Grant explicite des permissions SELECT
GRANT SELECT ON public.participants TO anon;
GRANT SELECT ON public.participants TO authenticated;
GRANT SELECT ON public.heat_entries TO anon;
GRANT SELECT ON public.heat_entries TO authenticated;

COMMIT;

-- 4. Tester immédiatement si ça fonctionne
SET ROLE anon;

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

-- 5. Afficher le résultat
SELECT '✅ POLICIES UPDATED - Participants should now be visible in public display!' as status;
