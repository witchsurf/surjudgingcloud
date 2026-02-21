import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    fetchHeatEntriesWithParticipants,
    fetchHeatSlotMappings,
    fetchHeatMetadata,
    fetchHeatScores
} from '../api/supabaseClient';
import { calculateSurferStats } from '../utils/scoring';

const COLORS_BY_POSITION: Record<number, string> = {
    1: 'ROUGE',
    2: 'BLANC',
    3: 'JAUNE',
    4: 'BLEU',
    5: 'NOIR',
    6: 'VERT'
};

const COLOR_MAP: Record<string, string> = {
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

const normalizeColor = (value?: string | null) => {
    if (!value) return '';
    return COLOR_MAP[value.toUpperCase()] || value.toUpperCase();
};

const isPlaceholderLike = (value?: string | null) => {
    if (!value) return false;
    const v = value.toUpperCase().trim();
    return v.includes('QUALIFI') ||
        v.includes('FINALISTE') ||
        v.includes('REPECH') ||
        v.startsWith('R') ||
        v.startsWith('RP') ||
        v.startsWith('POSITION') ||
        v === 'BYE';
};

async function resolveNamesFromMappings(
    heatId: string,
    mappings: Array<{
        position: number;
        source_round?: number | null;
        source_heat?: number | null;
        source_position?: number | null;
    }>
) {
    if (!supabase || !mappings.length) return {};

    const withSource = mappings.filter(
        (m) => m.source_round != null && m.source_heat != null && m.source_position != null
    );
    if (!withSource.length) return {};

    // Fast path: infer source heat_id from current heat_id pattern
    // ex: test_off_line_junior_r3_h1 -> test_off_line_junior_r1_h2
    const normalizedHeatId = (heatId || '').toLowerCase();
    const idMatch = normalizedHeatId.match(/^(.*)_r\d+_h\d+$/);
    const inferredPrefix = idMatch?.[1] || '';

    const sourceHeatIdByKey = new Map<string, string>();
    if (inferredPrefix) {
        withSource.forEach((mapping) => {
            const round = Number(mapping.source_round);
            const heat = Number(mapping.source_heat);
            const key = `${round}-${heat}`;
            if (!sourceHeatIdByKey.has(key)) {
                sourceHeatIdByKey.set(key, `${inferredPrefix}_r${round}_h${heat}`);
            }
        });
    } else {
        // Fallback: query heats table if pattern is not parsable
        const currentHeat = await fetchHeatMetadata(heatId);
        if (!currentHeat?.event_id || !currentHeat?.division) return {};

        const sourceRounds = Array.from(new Set(withSource.map((m) => Number(m.source_round))));
        const { data: sourceHeats, error } = await supabase
            .from('heats')
            .select('id, round, heat_number')
            .eq('event_id', currentHeat.event_id)
            .eq('division', currentHeat.division)
            .in('round', sourceRounds);

        if (error) {
            console.warn('[useHeatParticipants] Unable to query source heats', error);
            return {};
        }

        (sourceHeats || []).forEach((row: { id: string; round: number; heat_number: number }) => {
            sourceHeatIdByKey.set(`${row.round}-${row.heat_number}`, row.id);
        });
    }

    const namesByTargetColor: Record<string, string> = {};
    const rankCache = new Map<string, Map<number, string>>();
    const nameCache = new Map<string, Record<string, string>>();

    for (const mapping of withSource) {
        const sourceKey = `${mapping.source_round}-${mapping.source_heat}`;
        const sourceHeatId = sourceHeatIdByKey.get(sourceKey);
        if (!sourceHeatId) continue;

        if (!rankCache.has(sourceHeatId)) {
            const sourceEntries = await fetchHeatEntriesWithParticipants(sourceHeatId);
            const namesByColor = sourceEntries.reduce<Record<string, string>>((acc, entry) => {
                const color = normalizeColor(entry.color);
                const name = entry.participant?.name;
                if (!color || !name || isPlaceholderLike(name)) return acc;
                acc[color] = name;
                return acc;
            }, {});
            nameCache.set(sourceHeatId, namesByColor);

            const sourceScoresRaw = await fetchHeatScores(sourceHeatId);
            const sourceScores = sourceScoresRaw.map((score) => ({
                ...score,
                surfer: normalizeColor(score.surfer) || score.surfer
            }));
            const surfers = Object.keys(namesByColor);
            const judgeCount = new Set(sourceScores.map((score) => score.judge_id).filter(Boolean)).size;
            const stats = calculateSurferStats(sourceScores, surfers, Math.max(judgeCount, 1), 20, true);

            const rankToColor = new Map<number, string>();
            stats
                .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                .forEach((stat) => {
                    if (!rankToColor.has(stat.rank)) {
                        rankToColor.set(stat.rank, stat.surfer.toUpperCase());
                    }
                });

            rankCache.set(sourceHeatId, rankToColor);
        }

        const rankToColor = rankCache.get(sourceHeatId);
        const namesByColor = nameCache.get(sourceHeatId);
        if (!rankToColor || !namesByColor) continue;

        const sourceRank = Number(mapping.source_position);
        const sourceColor = rankToColor.get(sourceRank);
        if (!sourceColor) continue;

        const name = namesByColor[sourceColor];
        const targetColor = COLORS_BY_POSITION[mapping.position];
        if (name && targetColor) {
            namesByTargetColor[targetColor] = name;
        }
    }

    return namesByTargetColor;
}

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
                const entries = await fetchHeatEntriesWithParticipants(heatId);
                const entryNames = (entries || []).reduce((acc, entry) => {
                    const color = normalizeColor(entry.color);
                    if (!color) return acc;
                    const name = entry.participant?.name || color;
                    return { ...acc, [color]: name };
                }, {} as Record<string, string>);

                const hasRealEntryNames = Object.values(entryNames).some((name) => !isPlaceholderLike(name));
                if (hasRealEntryNames) {
                    console.log('[useHeatParticipants] Loaded from heat_entries', {
                        heatId,
                        count: entries.length,
                        names: Object.keys(entryNames)
                    });

                    setParticipants(entryNames);
                    setSource('entries');
                    setLoading(false);
                    return;
                }

                console.warn('[useHeatParticipants] No resolved entry names, trying mappings/source resolution', { heatId });

                const mappings = await fetchHeatSlotMappings(heatId);

                if (mappings && mappings.length > 0) {
                    const placeholderNames = mappings.reduce((acc, mapping) => {
                        const color = COLORS_BY_POSITION[mapping.position];
                        const placeholder = mapping.placeholder || `Position ${mapping.position}`;

                        if (color) {
                            return { ...acc, [color]: placeholder };
                        }
                        return acc;
                    }, {} as Record<string, string>);

                    const resolvedFromSource = await resolveNamesFromMappings(heatId, mappings);
                    const merged = {
                        ...placeholderNames,
                        ...entryNames,
                        ...resolvedFromSource
                    };

                    console.log('[useHeatParticipants] Loaded from heat_slot_mappings', {
                        heatId,
                        count: mappings.length,
                        placeholders: Object.keys(placeholderNames),
                        resolved: Object.keys(resolvedFromSource)
                    });

                    setParticipants(merged);
                    setSource(Object.keys(resolvedFromSource).length > 0 ? 'entries' : 'mappings');
                    setLoading(false);
                    return;
                }

                if (Object.keys(entryNames).length > 0) {
                    setParticipants(entryNames);
                    setSource('mappings');
                    setLoading(false);
                    return;
                }

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
