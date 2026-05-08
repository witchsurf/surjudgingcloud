-- ============================================================================
-- Fonction RPC pour l'ESP32 Priority LED Controller
-- Retourne UNIQUEMENT les données de priorité du heat actif
-- Réponse: ~200 bytes au lieu de ~15 KB avec config_data complet
-- ============================================================================

CREATE OR REPLACE FUNCTION get_active_priority()
RETURNS TABLE (
    heat_id TEXT,
    status TEXT,
    priority_state JSONB,
    surfers JSONB
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        hrc.heat_id::TEXT,
        hrc.status::TEXT,
        hrc.config_data->'priorityState' AS priority_state,
        hrc.config_data->'surfers' AS surfers
    FROM heat_realtime_config hrc
    ORDER BY hrc.updated_at DESC
    LIMIT 1;
$$;

-- Permettre l'accès anonyme (l'ESP32 utilise la clé anon)
GRANT EXECUTE ON FUNCTION get_active_priority() TO anon;
GRANT EXECUTE ON FUNCTION get_active_priority() TO authenticated;
