/**
 * PendingJudgeAssignmentPoller
 *
 * Polls the canonical podium judge assignments every 2s to detect when
 * the admin has assigned an official judge to this position. When the
 * assignment is complete, calls onReady() so the parent can reload/proceed.
 *
 * Used on judge tablets when they land on the kiosk screen before the admin
 * has saved the line-up — avoids requiring a manual refresh on the tablet.
 */

import { useEffect, useRef } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { panelRepository } from '../repositories/PanelRepository';
import { normalizePodiumId } from '../utils/podium';

interface Props {
  /** The judge position to watch, e.g. "J1" */
  position: string;
  /** Active event id, used to query the canonical podium panel. */
  eventId?: number | null;
  /** Podium whose permanent panel owns this station. */
  podiumId?: string | null;
  /** Called when the judge assignment is complete */
  onReady: () => void;
}

const POLL_INTERVAL_MS = 2000;

export function PendingJudgeAssignmentPoller({ position, eventId, podiumId, onReady }: Props) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!isSupabaseConfigured() || !getSupabaseClient()) return;

    const normalizedPos = position.trim().toUpperCase();
    const normalizedPodium = normalizePodiumId(podiumId);
    let active = true;

    const checkAssignment = async () => {
      try {
        // The podium panel is the canonical assignment source.
        if (eventId) {
          const panel = await panelRepository.getPodiumPanel(eventId, normalizedPodium);
          const assignment = panel?.assignments.find(
            (row) => row.station.trim().toUpperCase() === normalizedPos
          );
          if (assignment?.judgeName?.trim() && assignment?.judgeId?.trim()) {
            if (active) onReadyRef.current();
            return;
          }

        }

        // If the canonical panel has no complete assignment yet, wait for the
        // next poll. event_last_config has no config_data column and is global
        // to podium A, so it cannot safely answer this podium-scoped question.
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
  }, [position, eventId, podiumId]);

  // Renders nothing — it's a side-effect-only component
  return null;
}
