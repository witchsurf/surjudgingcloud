import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    fetchHeatEntriesWithParticipants,
    fetchHeatSlotMappings,
    fetchHeatMetadata,
    fetchHeatScores,
    fetchInterferenceCalls,
    fetchCategoryHeats,
    fetchAllScoresForEvent
} from '../api/supabaseClient';
import { calculateSurferStats } from '../utils/scoring';
import { colorLabelMap } from '../utils/colorUtils';
import { computeEffectiveInterferences } from '../utils/interference';

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
        placeholder?: string | null;
        source_round?: number | null;
        source_heat?: number | null;
        source_position?: number | null;
    }>
) {
    if (!supabase || !mappings.length) return {};
    const currentHeat = await fetchHeatMetadata(heatId);
    if (!currentHeat?.event_id || !currentHeat?.division) return {};

    const parseSourceFromPlaceholder = (placeholder?: string | null) => {
        const normalized = (placeholder || '').toUpperCase().trim();
        if (!normalized) return null;

        const direct = normalized.match(/R(P?)(\d+)-H(\d+)-P(\d+)/);
        if (direct) {
            return {
                round: Number(direct[2]),
                heat: Number(direct[3]),
                position: Number(direct[4]),
            };
        }

        const displayStyle = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)\s*\(P\s*(\d+)\)/);
        if (displayStyle) {
            return {
                round: Number(displayStyle[1]),
                heat: Number(displayStyle[2]),
                position: Number(displayStyle[3]),
            };
        }

        const loose = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)\s*[- ]?\s*P\s*(\d+)/);
        if (loose) {
            return {
                round: Number(loose[1]),
                heat: Number(loose[2]),
                position: Number(loose[3]),
            };
        }

        // Support placeholders without explicit position: "QUALIFIE R1-H2"
        const noPosition = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)/);
        if (noPosition) {
            return {
                round: Number(noPosition[1]),
                heat: Number(noPosition[2]),
                position: null,
            };
        }

        return null;
    };

    const withSourceBase = mappings
        .map((mapping) => {
            const parsed = parseSourceFromPlaceholder(mapping.placeholder);
            return {
                ...mapping,
                // Prefer placeholder-derived source when present: source_* can be stale/corrupted.
                source_round: parsed?.round ?? mapping.source_round ?? null,
                source_heat: parsed?.heat ?? mapping.source_heat ?? null,
                source_position: parsed?.position ?? mapping.source_position ?? null,
            };
        })
        .filter((m) => m.source_round != null && m.source_heat != null);

    // If mapping does not provide explicit source_position, assign it implicitly per source heat
    // in slot order (P1, P2, ...). This handles placeholders like "QUALIFIE R1-H2".
    const implicitCursor = new Map<string, number>();
    const withSource = withSourceBase
        .sort((a, b) => {
            const aRound = Number(a.source_round ?? 0);
            const bRound = Number(b.source_round ?? 0);
            if (aRound !== bRound) return aRound - bRound;
            const aHeat = Number(a.source_heat ?? 0);
            const bHeat = Number(b.source_heat ?? 0);
            if (aHeat !== bHeat) return aHeat - bHeat;
            return Number(a.position ?? 0) - Number(b.position ?? 0);
        })
        .map((m) => {
            if (m.source_position != null) return m;
            const key = `${m.source_round}-${m.source_heat}`;
            const next = (implicitCursor.get(key) ?? 0) + 1;
            implicitCursor.set(key, next);
            return { ...m, source_position: next };
        })
        .filter((m) => m.source_position != null);

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
            const sourceInterferenceCalls = await fetchInterferenceCalls(sourceHeatId);
            const sourceEffectiveInterferences = computeEffectiveInterferences(
                sourceInterferenceCalls,
                Math.max(judgeCount, 1)
            );
            const stats = calculateSurferStats(sourceScores, surfers, Math.max(judgeCount, 1), 20, true, sourceEffectiveInterferences);

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

    // Fallback 2: iterative qualifier propagation (same spirit as admin full PDF)
    // Works even when source_* columns are missing in mappings.
    if (Object.keys(namesByTargetColor).length === 0) {
        try {
            const rounds = await fetchCategoryHeats(currentHeat.event_id, currentHeat.division);
            const allScores = await fetchAllScoresForEvent(currentHeat.event_id);
            const normalizePlaceholderKey = (value: string) =>
                value
                    .toUpperCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[\(\)\[\]]/g, ' ')
                    .replace(/[_-]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

            const buildQualifierKeyVariants = (roundNumber: number, heatNumber: number, position: number) => ([
                `QUALIFIE R${roundNumber}-H${heatNumber} (P${position})`,
                `QUALIFIE R${roundNumber}-H${heatNumber} P${position}`,
                `QUALIFIE R${roundNumber} H${heatNumber} P${position}`,
                `FINALISTE R${roundNumber}-H${heatNumber} (P${position})`,
                `FINALISTE R${roundNumber}-H${heatNumber} P${position}`,
                `FINALISTE R${roundNumber} H${heatNumber} P${position}`,
                `R${roundNumber}-H${heatNumber}-P${position}`,
                `R${roundNumber} H${heatNumber} P${position}`,
            ]);

            const qualifierMap = new Map<string, string>();

            const resolveFromPlaceholderText = (text?: string) => {
                if (!text) return undefined;
                const normalized = normalizePlaceholderKey(text);
                let resolved = qualifierMap.get(normalized);
                if (!resolved) {
                    const match = normalized.match(/R\s*(\d+)\s*H\s*(\d+)\s*(?:P\s*)?(\d+)/);
                    if (match) {
                        const [, r, h, p] = match;
                        resolved = buildQualifierKeyVariants(Number(r), Number(h), Number(p))
                            .map((k) => qualifierMap.get(normalizePlaceholderKey(k)))
                            .find(Boolean);
                    }
                }
                return resolved;
            };

            const orderedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
            for (const round of orderedRounds) {
                for (const heat of round.heats) {
                    heat.slots.forEach((slot) => {
                        if (!slot.name && !slot.placeholder) return;
                        const candidate = slot.placeholder || slot.name;
                        if (!candidate || !isPlaceholderLike(candidate)) return;
                        const resolved = resolveFromPlaceholderText(candidate);
                        if (resolved) {
                            slot.name = resolved;
                            slot.placeholder = undefined;
                            slot.bye = false;
                        }
                    });

                    if (!heat.heatId) return;
                    const heatScores = allScores[heat.heatId] ?? [];
                    if (!heatScores.length) return;

                    const namesByColor = heat.slots.reduce<Record<string, string>>((acc, slot) => {
                        if (!slot.color || !slot.name || isPlaceholderLike(slot.name)) return acc;
                        const label = colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color;
                        const normalized = normalizeColor(label);
                        if (normalized) acc[normalized] = slot.name;
                        return acc;
                    }, {});

                    const surfers = Object.keys(namesByColor);
                    if (!surfers.length) return;

                    const normalizedScores = heatScores.map((score) => ({
                        ...score,
                        surfer: normalizeColor(score.surfer) || score.surfer
                    }));
                    const heatInterferenceCalls = await fetchInterferenceCalls(heat.heatId);
                    const heatEffectiveInterferences = computeEffectiveInterferences(
                        heatInterferenceCalls,
                        Math.max(new Set(normalizedScores.map((s) => s.judge_id).filter(Boolean)).size, 1)
                    );
                    const judgeCount = new Set(normalizedScores.map((s) => s.judge_id).filter(Boolean)).size;
                    const stats = calculateSurferStats(normalizedScores, surfers, Math.max(judgeCount, 1), 20, true, heatEffectiveInterferences);

                    stats
                        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                        .forEach((stat) => {
                            const name = namesByColor[stat.surfer.toUpperCase()];
                            if (!name) return;
                            buildQualifierKeyVariants(round.roundNumber, heat.heatNumber, stat.rank)
                                .forEach((key) => qualifierMap.set(normalizePlaceholderKey(key), name));
                        });
                }
            }

            const targetMappings = withSource.length > 0 ? withSource : mappings;
            targetMappings.forEach((mapping) => {
                const targetColor = COLORS_BY_POSITION[mapping.position];
                if (!targetColor) return;

                let name: string | undefined;
                if (mapping.source_round != null && mapping.source_heat != null && mapping.source_position != null) {
                    name = buildQualifierKeyVariants(
                        Number(mapping.source_round),
                        Number(mapping.source_heat),
                        Number(mapping.source_position)
                    )
                        .map((key) => qualifierMap.get(normalizePlaceholderKey(key)))
                        .find(Boolean);
                }

                if (!name) {
                    name = resolveFromPlaceholderText(mapping.placeholder || undefined);
                }

                if (name) {
                    namesByTargetColor[targetColor] = name;
                }
            });
        } catch (error) {
            console.warn('[useHeatParticipants] Bracket-score fallback failed', error);
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
                const entries = await fetchHeatEntriesWithParticipants(heatId);
                const entryNames = (entries || []).reduce((acc, entry) => {
                    const color = normalizeColor(entry.color);
                    const name = entry.participant?.name?.trim();
                    if (!color || !name) return acc;
                    return { ...acc, [color]: name };
                }, {} as Record<string, string>);

                const hasRealEntryNames = Object.values(entryNames).some((name) => {
                    const normalized = normalizeColor(name);
                    if (normalized && normalized in COLOR_MAP) return false;
                    return !isPlaceholderLike(name);
                });
                if (hasRealEntryNames) {
                    setParticipants(entryNames);
                    setSource('entries');
                    setLoading(false);
                    return;
                }

                const mappings = await fetchHeatSlotMappings(heatId);

                if (mappings && mappings.length > 0) {
                    const withSourceCount = mappings.filter(
                        (m) => m.source_round != null && m.source_heat != null && m.source_position != null
                    ).length;

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
                () => {
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
