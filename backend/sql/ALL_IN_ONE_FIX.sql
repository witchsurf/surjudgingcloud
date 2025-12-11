-- ============================================================================
-- SOLUTION COMPLÈTE EN UN SEUL SCRIPT
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '🔧 Début de la correction...';

    -- 1. Nettoyer les anciennes policies
    RAISE NOTICE '🧹 Nettoyage des anciennes policies...';

    DROP POLICY IF EXISTS participants_select ON public.participants;
    DROP POLICY IF EXISTS participants_insert ON public.participants;
    DROP POLICY IF EXISTS participants_update ON public.participants;
    DROP POLICY IF EXISTS participants_delete ON public.participants;
    DROP POLICY IF EXISTS participants_public_read ON public.participants;
    DROP POLICY IF EXISTS participants_auth_write ON public.participants;

    DROP POLICY IF EXISTS heat_entries_select ON public.heat_entries;
    DROP POLICY IF EXISTS heat_entries_insert ON public.heat_entries;
    DROP POLICY IF EXISTS heat_entries_update ON public.heat_entries;
    DROP POLICY IF EXISTS heat_entries_delete ON public.heat_entries;
    DROP POLICY IF EXISTS heat_entries_public_read ON public.heat_entries;
    DROP POLICY IF EXISTS heat_entries_auth_write ON public.heat_entries;

    -- 2. Créer les nouvelles policies publiques
    RAISE NOTICE '✅ Création des policies publiques...';

    -- Participants: lecture publique, écriture authentifiée
    EXECUTE 'CREATE POLICY participants_public_read ON public.participants
      FOR SELECT USING (true)';

    EXECUTE 'CREATE POLICY participants_auth_write ON public.participants
      FOR ALL
      USING (auth.role() IN (''authenticated'', ''service_role''))
      WITH CHECK (auth.role() IN (''authenticated'', ''service_role''))';

    -- Heat entries: lecture publique, écriture authentifiée
    EXECUTE 'CREATE POLICY heat_entries_public_read ON public.heat_entries
      FOR SELECT USING (true)';

    EXECUTE 'CREATE POLICY heat_entries_auth_write ON public.heat_entries
      FOR ALL
      USING (auth.role() IN (''authenticated'', ''service_role''))
      WITH CHECK (auth.role() IN (''authenticated'', ''service_role''))';

    -- 3. Grant explicites
    RAISE NOTICE '🔐 Attribution des permissions...';

    GRANT SELECT ON public.participants TO anon;
    GRANT SELECT ON public.participants TO authenticated;
    GRANT SELECT ON public.heat_entries TO anon;
    GRANT SELECT ON public.heat_entries TO authenticated;

    RAISE NOTICE '✅ Correction terminée!';
END $$;

-- Vérification immédiate
SELECT '📋 VERIFICATION DES POLICIES' as section;

SELECT
    tablename,
    policyname,
    roles::text[] as allowed_roles,
    cmd as command
FROM pg_policies
WHERE tablename IN ('participants', 'heat_entries')
ORDER BY tablename, policyname;

-- Test en tant qu'anon
SELECT '🧪 TEST EN TANT QUE ROLE ANON' as section;

SET ROLE anon;

SELECT
    he.heat_id,
    he.color,
    he.position,
    p.id as participant_id,
    p.name as participant_name,
    p.country,
    CASE
        WHEN p.name IS NOT NULL THEN '✅ Nom visible'
        WHEN p.id IS NOT NULL AND p.name IS NULL THEN '⚠️ Participant existe mais nom NULL'
        ELSE '❌ Pas de participant lié'
    END as status
FROM heat_entries he
LEFT JOIN participants p ON p.id = he.participant_id
WHERE he.heat_id = 'MOGO_CUP_junior_R1_H1'
ORDER BY he.position;

RESET ROLE;

-- Message final
SELECT '✅ Si vous voyez les noms ci-dessus, le problème RLS est résolu!' as final_message
UNION ALL
SELECT '🔄 Maintenant: Videz le cache du navigateur (Cmd+Shift+R) et rechargez la page' as instruction;
