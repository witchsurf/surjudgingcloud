-- ============================================================================
-- UPGRADE_LOCAL_HEAT_WORKFLOW_20260418.sql
-- ============================================================================
-- Align local HP workflow schema with the current field-closing behavior:
-- 1. Allow `open` in heat_realtime_config so legacy/local sync triggers do not
--    fail when they mirror heats.status into realtime rows.
-- 2. Ensure active_heat_pointer has a real unique constraint on event_id so
--    trigger code using `ON CONFLICT (event_id)` works on local HP stacks.
-- ============================================================================

BEGIN;

ALTER TABLE public.heat_realtime_config
  DROP CONSTRAINT IF EXISTS heat_realtime_config_status_check;

ALTER TABLE public.heat_realtime_config
  ADD CONSTRAINT heat_realtime_config_status_check
  CHECK (status IN ('waiting', 'running', 'paused', 'finished', 'closed', 'open'));

DROP INDEX IF EXISTS public.idx_active_heat_pointer_event_id_unique;

ALTER TABLE public.active_heat_pointer
  DROP CONSTRAINT IF EXISTS active_heat_pointer_event_id_key;

ALTER TABLE public.active_heat_pointer
  ADD CONSTRAINT active_heat_pointer_event_id_key UNIQUE (event_id);

COMMIT;

SELECT 'OK: UPGRADE_LOCAL_HEAT_WORKFLOW_20260418 applied' AS result;
