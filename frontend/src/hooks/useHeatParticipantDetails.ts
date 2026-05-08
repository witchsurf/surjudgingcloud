import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchHeatEntriesWithParticipants, fetchHeatSlotMappings, isSupabaseConfigured } from '../api/supabaseClient';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { subscribeToHeatParticipants } from '../lib/sharedHeatTableSubscriptions';

export type HeatParticipantInfo = {
  jersey: string;
  name: string;
  country?: string | null;
};

const COLORS_BY_POSITION: Record<number, string> = {
  1: 'ROUGE',
  2: 'BLANC',
  3: 'JAUNE',
  4: 'BLEU',
  5: 'NOIR',
  6: 'VERT',
};

const normalizeKey = (value?: string | null) => (value ?? '').trim().toUpperCase();
const normalizeJerseyColor = (value?: string | null) => {
  const upper = normalizeKey(value);
  if (!upper) return '';
  return ((colorLabelMap as unknown as Record<string, string>)[upper] ?? upper).trim().toUpperCase();
};

type UseHeatParticipantDetailsArgs = {
  heatId: string | null;
  surfers: string[];
  enabled?: boolean;
};

export function useHeatParticipantDetails({ heatId, surfers, enabled = true }: UseHeatParticipantDetailsArgs) {
  const [entryMap, setEntryMap] = useState<Map<string, HeatParticipantInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const activeHeatIdRef = useRef<string | null>(heatId);

  const fallbackMap = useMemo(() => {
    const fallback = new Map<string, HeatParticipantInfo>();
    surfers.forEach((label) => {
      const key = normalizeJerseyColor(label) || normalizeKey(label);
      if (!key) return;
      fallback.set(key, { jersey: key, name: key });
    });
    return fallback;
  }, [surfers]);

  useEffect(() => {
    activeHeatIdRef.current = heatId;
    if (!enabled || !heatId) {
      setEntryMap(fallbackMap);
      setLoading(false);
      setError(null);
      return;
    }

    if (!isSupabaseConfigured()) {
      setEntryMap(fallbackMap);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const isStale = (requestedHeatId: string) =>
      cancelled || activeHeatIdRef.current !== requestedHeatId;

    const load = async (requestedHeatId: string) => {
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }
      inFlightRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const entries = await fetchHeatEntriesWithParticipants(requestedHeatId);
        if (isStale(requestedHeatId)) return;

        const nextMap = new Map<string, HeatParticipantInfo>();
        let hasRealNames = false;

        entries.forEach((row) => {
          const position = typeof row.position === 'number' ? row.position : Number(row.position);
          const fromColor = normalizeJerseyColor(row.color as HeatColor | string | null);
          const fromSurferLabels = position >= 1 && position <= surfers.length
            ? normalizeJerseyColor(surfers[position - 1])
            : '';
          const fromPosition = position >= 1 ? COLORS_BY_POSITION[position] ?? '' : '';
          const jerseyKey = fromColor || fromSurferLabels || fromPosition;
          const key = normalizeKey(jerseyKey);
          if (!key) return;

          const name = row.participant?.name?.trim() || jerseyKey || key;
          if (row.participant?.name) {
            hasRealNames = true;
          }

          nextMap.set(key, {
            jersey: jerseyKey || key,
            name,
            country: row.participant?.country ?? null,
          });
        });

        // If no real entries yet (R2+), fallback to slot mappings placeholders.
        if (!hasRealNames) {
          const mappings = await fetchHeatSlotMappings(requestedHeatId).catch(() => []);
          if (isStale(requestedHeatId)) return;

          if (Array.isArray(mappings) && mappings.length > 0) {
            mappings.forEach((mapping) => {
              const color = COLORS_BY_POSITION[mapping.position] ?? '';
              const key = normalizeKey(color);
              if (!key) return;
              const placeholder = String(mapping.placeholder || `Position ${mapping.position}`).trim();
              nextMap.set(key, {
                jersey: key,
                name: placeholder || key,
                country: null,
              });
            });
          }
        }

        // Ensure all configured surfers exist as fallback keys.
        surfers.forEach((label) => {
          const key = normalizeJerseyColor(label) || normalizeKey(label);
          if (!key) return;
          if (!nextMap.has(key)) {
            nextMap.set(key, { jersey: key, name: key });
          }
        });

        setEntryMap(nextMap.size ? nextMap : fallbackMap);
      } catch (err) {
        console.error('❌ Chargement participants heat impossible:', err);
        const message = err instanceof Error ? err.message : 'Impossible de charger les participants du heat.';
        if (!isStale(requestedHeatId)) {
          setError(message);
          setEntryMap(fallbackMap);
        }
      } finally {
        inFlightRef.current = false;
        if (!cancelled && pendingRef.current) {
          pendingRef.current = false;
          void load(requestedHeatId);
          return;
        }
        if (!cancelled) setLoading(false);
      }
    };

    void load(heatId);
    const unsubscribe = subscribeToHeatParticipants(heatId, () => {
      void load(heatId);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, heatId, surfers, fallbackMap]);

  return { entryMap, loading, error };
}

