import { useState, useEffect, useRef } from 'react';
import { fetchHeatBySchedule, fetchActiveHeatPointer } from '../api/modules/heats.api';
import { ensurePersistedHeatId } from '../utils/heat';
import { normalizePodiumId } from '../utils/podium';
import { isSupabaseConfigured } from '../lib/supabase';

export interface UseAuthoritativeHeatIdParams {
  eventId?: number | null;
  division?: string | null;
  round?: number | null;
  heatNumber?: number | null;
  podiumId?: string | null;
}

export interface UseAuthoritativeHeatIdResult {
  heatId: string;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves the authoritative opaque `public.heats.id` from PostgreSQL / active_heat_pointer.
 * During asynchronous lookup, `heatId` is strictly empty string ('').
 * NEVER generates a synthetic fallback heat ID.
 */
export function useAuthoritativeHeatId(params: UseAuthoritativeHeatIdParams): UseAuthoritativeHeatIdResult {
  const { eventId, division, round, heatNumber, podiumId } = params;
  const [heatId, setHeatId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;
    const normalizedPodium = normalizePodiumId(podiumId);
    const validEventId = Number.isFinite(eventId) && (eventId ?? 0) > 0 ? Number(eventId) : null;
    const validDivision = (division || '').trim();
    const validRound = Number.isFinite(round) && (round ?? 0) > 0 ? Number(round) : null;
    const validHeatNumber = Number.isFinite(heatNumber) && (heatNumber ?? 0) > 0 ? Number(heatNumber) : null;

    if (!validEventId || !isSupabaseConfigured()) {
      setHeatId('');
      setLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setError(null);
    setHeatId(''); // Strictly reset to empty during asynchronous lookup to avoid race conditions

    const resolveHeatId = async () => {
      try {
        // 1. Primary: resolve directly by schedule if division, round and heatNumber are defined
        if (validDivision && validRound !== null && validHeatNumber !== null) {
          const scheduledHeat = await fetchHeatBySchedule(
            validEventId,
            validDivision,
            validRound,
            validHeatNumber
          );
          if (isCancelled || requestIdRef.current !== currentRequestId) return;

          if (scheduledHeat?.id) {
            setHeatId(ensurePersistedHeatId(scheduledHeat.id));
            setLoading(false);
            setError(null);
            return;
          }
        }

        // 2. Fallback: resolve from active_heat_pointer for (eventId, podiumId)
        if (normalizedPodium) {
          const pointer = await fetchActiveHeatPointer(validEventId, undefined, normalizedPodium);
          if (isCancelled || requestIdRef.current !== currentRequestId) return;

          if (pointer?.active_heat_id) {
            setHeatId(ensurePersistedHeatId(pointer.active_heat_id));
            setLoading(false);
            setError(null);
            return;
          }
        }

        if (isCancelled || requestIdRef.current !== currentRequestId) return;
        setHeatId('');
        setLoading(false);
        setError('Heat planifié introuvable');
      } catch (err) {
        if (isCancelled || requestIdRef.current !== currentRequestId) return;
        setHeatId('');
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Erreur de résolution du heat');
      }
    };

    void resolveHeatId();

    return () => {
      isCancelled = true;
    };
  }, [eventId, division, round, heatNumber, podiumId]);

  return { heatId, loading, error };
}
