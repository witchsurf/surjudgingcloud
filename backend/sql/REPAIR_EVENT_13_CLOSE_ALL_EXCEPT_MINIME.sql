-- Repair event 13 so only MINIME remains selectable/open.
-- Event: CHAMPIONNATS DU SENEGAL 2026

BEGIN;

UPDATE public.heats
SET
  status = 'closed',
  closed_at = COALESCE(closed_at, NOW())
WHERE event_id = 13
  AND UPPER(TRIM(division)) <> 'MINIME'
  AND status <> 'closed';

UPDATE public.heat_realtime_config
SET
  status = 'finished',
  timer_start_time = NULL,
  updated_by = 'repair_event_13_close_all_except_minime'
WHERE heat_id IN (
  SELECT id
  FROM public.heats
  WHERE event_id = 13
    AND UPPER(TRIM(division)) <> 'MINIME'
);

INSERT INTO public.active_heat_pointer (event_name, active_heat_id, updated_at)
VALUES ('CHAMPIONNATS DU SENEGAL 2026', 'championnats_du_senegal_2026_minime_r1_h1', NOW())
ON CONFLICT (event_name)
DO UPDATE SET
  active_heat_id = EXCLUDED.active_heat_id,
  updated_at = EXCLUDED.updated_at;

COMMIT;
