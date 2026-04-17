/**
 * PendingJudgeAssignmentPoller
 *
 * Polls heat_realtime_config / event_last_config every 2s to detect when
 * the admin has assigned an official judge to this position. When the
 * assignment is complete, calls onReady() so the parent can reload/proceed.
 *
 * Used on judge tablets when they land on the kiosk screen before the admin
 * has saved the line-up — avoids requiring a manual refresh on the tablet.
 */

import { useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface Props {
  /** The judge position to watch, e.g. "J1" */
  position: string;
  /** Active event id, used to query event_last_config */
  eventId?: number | null;
  /** Called when the judge assignment is complete */
  onReady: () => void;
}

const POLL_INTERVAL_MS = 2000;

export function PendingJudgeAssignmentPoller({ position, eventId, onReady }: Props) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const normalizedPos = position.trim().toUpperCase();
    let active = true;

    const checkAssignment = async () => {
      try {
        // Prefer event_last_config (config snapshot saved by admin)
        if (eventId) {
          const { data } = await supabase!
            .from('event_last_config')
            .select('config_data')
            .eq('event_id', eventId)
            .maybeSingle();

          if (data?.config_data) {
            const cfg = data.config_data as {
              judgeNames?: Record<string, string>;
              judgeIdentities?: Record<string, string>;
            };
            const safeNames = Object.fromEntries(
              Object.entries(cfg.judgeNames || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
            );
            const safeIds = Object.fromEntries(
              Object.entries(cfg.judgeIdentities || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
            );
            if (safeNames[normalizedPos]?.trim() && safeIds[normalizedPos]?.trim()) {
              if (active) onReadyRef.current();
              return;
            }
          }
        }

        // Fallback: look in heat_realtime_config (in case admin only published via realtime)
        // We can't easily know the heat_id here, so we rely on event_last_config only.
        // If neither source has the data, we wait for the next poll.
      } catch (err) {
        console.warn('⚠️ PendingJudgeAssignmentPoller: poll error', err);
      }
    };

    void checkAssignment();
    const interval = setInterval(() => {
      void checkAssignment();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [position, eventId]);

  // Renders nothing — it's a side-effect-only component
  return null;
}
