-- ==========================================================
-- SETUP TRIGGERS POUR LE SYSTÈME HYBRIDE (POST-LIGUE PRO)
-- ==========================================================
-- Ce script crée les fonctions et triggers nécessaires pour que
-- PostgreSQL notifie le serveur VPS lors de changements critiques.

-- 1. Fonction de notification universelle
CREATE OR REPLACE FUNCTION notify_vps_realy()
RETURNS trigger AS $$
DECLARE
  payload JSON;
BEGIN
  -- Construction du payload
  -- TG_ARGV[0] est le nom du channel (score_submitted, etc.)
  payload = json_build_object(
    'channel', TG_ARGV[0],
    'data', row_to_json(NEW)
  );
  
  -- Envoi de la notification
  PERFORM pg_notify('sync_event', payload::text);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger pour les Scores
-- S'active lors de l'insertion ou mise à jour d'une note
DROP TRIGGER IF EXISTS tr_notify_score ON scores;
CREATE TRIGGER tr_notify_score
AFTER INSERT OR UPDATE ON scores
FOR EACH ROW EXECUTE FUNCTION notify_vps_realy('score_submitted');

-- 3. Trigger pour le Timer et la Config (état du heat)
DROP TRIGGER IF EXISTS tr_notify_heat_config ON heat_realtime_config;
CREATE TRIGGER tr_notify_heat_config
AFTER INSERT OR UPDATE ON heat_realtime_config
FOR EACH ROW EXECUTE FUNCTION notify_vps_realy('heat_config_updated');

-- NOTE: Pour que le serveur VPS reçoive ces notifications, il doit 
-- faire un "LISTEN sync_event;".
