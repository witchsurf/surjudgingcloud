-- ============================================================================
-- Fix participant visibility for public display
-- Les noms des participants doivent être visibles publiquement
-- ============================================================================

-- Drop the old restrictive policy
DROP POLICY IF EXISTS participants_select ON public.participants;

-- Create a new permissive policy that allows everyone to read participant data
-- This is appropriate because participant names are public information in competitions
CREATE POLICY participants_public_read ON public.participants
  FOR SELECT
  USING (true);

-- Ensure the policy works for JOINs by granting explicit SELECT permission
GRANT SELECT ON public.participants TO anon;
GRANT SELECT ON public.participants TO authenticated;

-- Also ensure heat_entries is readable
DROP POLICY IF EXISTS heat_entries_select ON public.heat_entries;

CREATE POLICY heat_entries_public_read ON public.heat_entries
  FOR SELECT
  USING (true);

GRANT SELECT ON public.heat_entries TO anon;
GRANT SELECT ON public.heat_entries TO authenticated;

-- Verify the policies were created
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles::text[],
    cmd,
    qual as using_clause
FROM pg_policies
WHERE tablename IN ('participants', 'heat_entries')
  AND cmd = 'SELECT'
ORDER BY tablename, policyname;
