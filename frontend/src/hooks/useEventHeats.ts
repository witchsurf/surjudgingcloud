import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface HeatData {
    division: string;
    round: number;
    heat_number: number;
}

interface UseEventHeatsReturn {
    divisions: string[];
    rounds: Record<string, number[]>;
    heats: Record<string, number[]>; // key: "division_round"
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

/**
 * Hook to load and organize heats data for an event
 * Returns divisions, rounds per division, and heats per division+round
 */
export function useEventHeats(eventId: number | null): UseEventHeatsReturn {
    const [divisions, setDivisions] = useState<string[]>([]);
    const [rounds, setRounds] = useState<Record<string, number[]>>({});
    const [heats, setHeats] = useState<Record<string, number[]>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadHeats = async () => {
        if (!eventId || !isSupabaseConfigured() || !supabase) {
            setDivisions([]);
            setRounds({});
            setHeats({});
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data, error: fetchError } = await supabase
                .from('heats')
                .select('division, round, heat_number')
                .eq('event_id', eventId)
                .order('division', { ascending: true })
                .order('round', { ascending: true })
                .order('heat_number', { ascending: true });

            if (fetchError) throw fetchError;

            const heatData = (data || []) as HeatData[];

            // Extract unique divisions
            const uniqueDivisions = Array.from(
                new Set(heatData.map(h => h.division))
            ).sort();

            // Build rounds per division
            const roundsMap: Record<string, number[]> = {};
            uniqueDivisions.forEach(div => {
                const divisionRounds = Array.from(
                    new Set(
                        heatData
                            .filter(h => h.division === div)
                            .map(h => h.round)
                    )
                ).sort((a, b) => a - b);
                roundsMap[div] = divisionRounds;
            });

            // Build heats per division+round
            const heatsMap: Record<string, number[]> = {};
            uniqueDivisions.forEach(div => {
                roundsMap[div].forEach(round => {
                    const key = `${div}_${round}`;
                    const roundHeats = Array.from(
                        new Set(
                            heatData
                                .filter(h => h.division === div && h.round === round)
                                .map(h => h.heat_number)
                        )
                    ).sort((a, b) => a - b);
                    heatsMap[key] = roundHeats;
                });
            });

            setDivisions(uniqueDivisions);
            setRounds(roundsMap);
            setHeats(heatsMap);
        } catch (err) {
            console.error('Failed to load heats:', err);
            setError(err instanceof Error ? err.message : 'Failed to load heats');
            setDivisions([]);
            setRounds({});
            setHeats({});
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadHeats();
    }, [eventId]);

    return {
        divisions,
        rounds,
        heats,
        loading,
        error,
        refresh: loadHeats
    };
}
