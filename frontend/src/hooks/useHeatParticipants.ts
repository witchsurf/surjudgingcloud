import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchHeatEntriesWithParticipants, fetchHeatSlotMappings } from '../api/supabaseClient';

/**
 * Hook to load participant names/placeholders for a heat
 * 
 * Loading strategy:
 * 1. Try heat_entries (real participants) - R1 heats with assigned surfers
 * 2. Fallback to heat_slot_mappings (placeholders) - R2+ heats waiting for winners
 * 3. Final fallback to empty colors - Should never happen in production
 * 
 * @param heatId - Normalized heat ID (e.g., "djegane_surf_trophy_ondine_u16_r1_h1")
 * @returns Object mapping colors to participant names or placeholders
 */
export function useHeatParticipants(heatId: string) {
    const [participants, setParticipants] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<'entries' | 'mappings' | 'empty'>('empty');

    useEffect(() => {
        if (!heatId || !supabase) {
            setParticipants({});
            setSource('empty');
            return;
        }

        const loadParticipants = async () => {
            setLoading(true);
            setError(null);

            try {
                console.log('[useHeatParticipants] Loading participants for heat', { heatId });

                // Color mapping: DB uses English, UI uses French
                const colorMap: Record<string, string> = {
                    RED: 'ROUGE',
                    WHITE: 'BLANC',
                    YELLOW: 'JAUNE',
                    BLUE: 'BLEU',
                    BLACK: 'NOIR',
                    GREEN: 'VERT',
                    ROUGE: 'ROUGE',
                    BLANC: 'BLANC',
                    JAUNE: 'JAUNE',
                    BLEU: 'BLEU',
                    NOIR: 'NOIR',
                    VERT: 'VERT'
                };

                // Strategy 1: robust read path from shared API helper
                const entries = await fetchHeatEntriesWithParticipants(heatId);

                if (entries && entries.length > 0) {
                    const names = entries.reduce((acc, entry) => {
                        const colorKey = entry.color?.toUpperCase() || '';
                        const colorFR = colorMap[colorKey] || colorKey;
                        const name = entry.participant?.name || colorFR;

                        if (colorFR) {
                            return { ...acc, [colorFR]: name };
                        }
                        return acc;
                    }, {} as Record<string, string>);

                    console.log('[useHeatParticipants] Loaded from heat_entries', {
                        heatId,
                        count: entries.length,
                        names: Object.keys(names)
                    });

                    setParticipants(names);
                    setSource('entries');
                    setLoading(false);
                    return;
                }

                // Strategy 2: Fallback to heat_slot_mappings (placeholders)
                console.warn('[useHeatParticipants] No heat_entries found, trying heat_slot_mappings', { heatId });

                const mappings = await fetchHeatSlotMappings(heatId);

                if (mappings && mappings.length > 0) {
                    // Map position to standard colors
                    const colorsByPosition: Record<number, string> = {
                        1: 'ROUGE',
                        2: 'BLANC',
                        3: 'JAUNE',
                        4: 'BLEU',
                        5: 'NOIR',
                        6: 'VERT'
                    };

                    const names = mappings.reduce((acc, mapping) => {
                        const color = colorsByPosition[mapping.position];
                        const placeholder = mapping.placeholder || `Position ${mapping.position}`;

                        if (color) {
                            return { ...acc, [color]: placeholder };
                        }
                        return acc;
                    }, {} as Record<string, string>);

                    console.log('[useHeatParticipants] Loaded from heat_slot_mappings', {
                        heatId,
                        count: mappings.length,
                        placeholders: Object.keys(names)
                    });

                    setParticipants(names);
                    setSource('mappings');
                    setLoading(false);
                    return;
                }

                // Strategy 3: Final fallback - empty colors (shouldn't happen)
                console.warn('[useHeatParticipants] No participants or mappings found, using empty state', { heatId });
                setParticipants({});
                setSource('empty');
                setLoading(false);

            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error loading participants';
                console.error('[useHeatParticipants] Failed to load participants', { heatId, error: message });
                setError(message);
                setParticipants({});
                setSource('empty');
                setLoading(false);
            }
        };

        loadParticipants();

        // Subscribe to real-time changes
        const subscription = supabase!
            .channel(`heat_participants_${heatId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'heat_entries',
                    filter: `heat_id=eq.${heatId}`
                },
                (payload) => {
                    console.log('[useHeatParticipants] Realtime update received:', payload);
                    loadParticipants();
                }
            )
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [heatId]);

    return { participants, loading, error, source };
}
