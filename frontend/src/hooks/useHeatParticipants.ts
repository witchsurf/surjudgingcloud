import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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

    useEffect(() => {
        if (!heatId || !supabase) {
            setParticipants({});
            return;
        }

        const loadParticipants = async () => {
            setLoading(true);
            setError(null);

            try {
                console.log('[useHeatParticipants] Loading participants for heat', { heatId });

                // Strategy 1: Try heat_entries (real participants)
                const { data: entries, error: entriesError } = await supabase!
                    .from('heat_entries')
                    .select(`
                        color,
                        position,
                        participant:participants(name, country)
                    `)
                    .eq('heat_id', heatId)
                    .order('position', { ascending: true });

                if (entriesError) throw entriesError;

                if (entries && entries.length > 0) {
                    // Color mapping: DB uses English, UI uses French
                    const colorMap: Record<string, string> = {
                        RED: 'ROUGE',
                        WHITE: 'BLANC',
                        YELLOW: 'JAUNE',
                        BLUE: 'BLEU',
                        BLACK: 'NOIR',
                        GREEN: 'VERT'
                    };

                    const names = entries.reduce((acc, entry) => {
                        const colorEN = entry.color?.toUpperCase() || '';
                        const colorFR = colorMap[colorEN] || colorEN; // Translate or fallback to original
                        // participant is an array from the join, get first element
                        const participant = Array.isArray(entry.participant) ? entry.participant[0] : entry.participant;
                        const name = participant?.name || colorFR;

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
                    setLoading(false);
                    return;
                }

                // Strategy 2: Fallback to heat_slot_mappings (placeholders)
                console.warn('[useHeatParticipants] No heat_entries found, trying heat_slot_mappings', { heatId });

                const { data: mappings, error: mappingsError } = await supabase!
                    .from('heat_slot_mappings')
                    .select('position, placeholder')
                    .eq('heat_id', heatId)
                    .order('position', { ascending: true });

                if (mappingsError) throw mappingsError;

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
                    setLoading(false);
                    return;
                }

                // Strategy 3: Final fallback - empty colors (shouldn't happen)
                console.warn('[useHeatParticipants] No participants or mappings found, using empty state', { heatId });
                setParticipants({});
                setLoading(false);

            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error loading participants';
                console.error('[useHeatParticipants] Failed to load participants', { heatId, error: message });
                setError(message);
                setParticipants({});
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

    return { participants, loading, error };
}
