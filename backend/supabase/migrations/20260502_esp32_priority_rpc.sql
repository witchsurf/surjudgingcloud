-- ============================================================================
-- Mise à jour de la fonction RPC pour l'ESP32 Priority LED Controller v2.0
-- Ajoute le calcul du temps restant pour le clignotement fin de série
-- ============================================================================

CREATE OR REPLACE FUNCTION get_active_priority()
RETURNS TABLE (
    heat_id TEXT,
    status TEXT,
    priority_state JSONB,
    surfers JSONB,
    timer_remaining_seconds INTEGER
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        hrc.heat_id::TEXT,
        hrc.status::TEXT,
        hrc.config_data->'priorityState' AS priority_state,
        hrc.config_data->'surfers' AS surfers,
        -- Calcul du temps restant en secondes
        CASE
            WHEN ht.is_running AND ht.start_time IS NOT NULL THEN
                GREATEST(0,
                    (ht.duration_minutes * 60)
                    - EXTRACT(EPOCH FROM (now() - ht.start_time))::INTEGER
                )
            ELSE NULL
        END AS timer_remaining_seconds
    FROM heat_realtime_config hrc
    LEFT JOIN heat_timers ht ON ht.heat_id = hrc.heat_id
    ORDER BY hrc.updated_at DESC
    LIMIT 1;
$$;

-- Permettre l'accès anonyme (l'ESP32 utilise la clé anon)
GRANT EXECUTE ON FUNCTION get_active_priority() TO anon;
GRANT EXECUTE ON FUNCTION get_active_priority() TO authenticated;
