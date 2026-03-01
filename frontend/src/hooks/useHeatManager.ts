import { useCallback } from 'react';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import { useSupabaseSync } from './useSupabaseSync';
import { useRealtimeSync } from './useRealtimeSync';
import { useCompetitionTimer } from './useCompetitionTimer';
import {
    fetchOrderedHeatSequence,
    fetchHeatEntriesWithParticipants,
    fetchHeatSlotMappings,
    fetchInterferenceCalls,
    replaceHeatEntries,
} from '../api/supabaseClient';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { calculateSurferStats } from '../utils/scoring';
import { computeEffectiveInterferences } from '../utils/interference';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { eventRepository } from '../repositories';
import { HEAT_COLOR_CACHE_KEY, DEFAULT_TIMER_DURATION } from '../utils/constants';
import type { AppConfig } from '../types';

// Helper to normalize heat entries
const normalizeHeatEntries = (entries: unknown): any[] => {
    if (Array.isArray(entries)) {
        return entries;
    }
    return [];
};

const getFallbackColorForPosition = (position: number): string | null => {
    switch (position) {
        case 1:
            return 'RED';
        case 2:
            return 'WHITE';
        case 3:
            return 'YELLOW';
        case 4:
            return 'BLUE';
        case 5:
            return 'GREEN';
        case 6:
            return 'BLACK';
        default:
            return null;
    }
};

export function useHeatManager() {
    const { config, setConfig, persistConfig, activeEventId } = useConfigStore();
    const {
        scores,
        setScores,
        setHeatStatus,
        judgeWorkCount,
        setJudgeWorkCount
    } = useJudgingStore();

    const {
        updateHeatStatus,
        createHeat,
        saveHeatConfig,
        saveTimerState
    } = useSupabaseSync();

    const {
        publishTimerPause,
        markHeatFinished,
        publishConfigUpdate,
        publishTimerReset
    } = useRealtimeSync();

    const { resetTimer } = useCompetitionTimer();

    const currentHeatId = getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
    ).normalized;

    const closeHeat = useCallback(async () => {
        const closedAt = new Date().toISOString();

        // 1. Pause Timer & Update Status
        try {
            await publishTimerPause(currentHeatId);
        } catch (error) {
            console.warn('Impossible de mettre le timer en pause', error);
        }

        try {
            await updateHeatStatus(currentHeatId, 'closed', closedAt);
            console.log('✅ Heat fermé:', currentHeatId);
        } catch (error) {
            console.log('⚠️ Heat fermé en mode local uniquement', error);
        }

        try {
            await markHeatFinished(currentHeatId);
        } catch (error) {
            console.warn('Impossible de marquer le heat comme terminé', error);
        }

        setHeatStatus('finished');

        // 2. Update Judge Work Count
        const newWorkCount = { ...judgeWorkCount };
        config.judges.forEach(judgeId => {
            newWorkCount[judgeId] = (newWorkCount[judgeId] || 0) + 1;
        });
        setJudgeWorkCount(newWorkCount);
        localStorage.setItem('surfJudgingJudgeWorkCount', JSON.stringify(newWorkCount));

        // 3. Prepare Next Heat Logic
        let colorCacheChanged = false;
        let colorCache: Record<string, Record<string, { name?: string; country?: string }>> = {};

        if (typeof window !== 'undefined') {
            const rawColorCache = window.localStorage.getItem(HEAT_COLOR_CACHE_KEY);
            if (rawColorCache) {
                try {
                    colorCache = JSON.parse(rawColorCache);
                } catch (error) {
                    console.warn('Impossible de lire le cache de couleurs', error);
                }
            }
        }

        let sequence: any[] = [];
        const currentHeatScores = (scores || []).filter(
            (score) => ensureHeatId(score.heat_id) === currentHeatId && Number(score.score) > 0
        );
        const hasCurrentHeatResults = currentHeatScores.length > 0;

        if (activeEventId && isSupabaseConfigured()) {
            try {
                sequence = await fetchOrderedHeatSequence(activeEventId, config.division);
            } catch (error) {
                console.warn('Impossible de récupérer la séquence des heats', error);
            }

            // Logic to advance qualifiers (complex logic from App.tsx)
            if (hasCurrentHeatResults) {
                try {
                const currentEntriesRaw = await fetchHeatEntriesWithParticipants(currentHeatId);
                const currentEntries = normalizeHeatEntries(currentEntriesRaw);

                if (currentEntries.length) {
                    // ... (Simplified for brevity, but ideally should copy the full logic from App.tsx)
                    // For now, I will assume the logic in App.tsx is critical and should be preserved.
                    // I will copy the core logic here.

                    const entryByColor = new Map<string, any>();
                    currentEntries.forEach((entry) => {
                        const rawColor = entry.color ? entry.color.toUpperCase() : '';
                        const label = rawColor ? colorLabelMap[(rawColor as HeatColor)] ?? rawColor : '';
                        if (!label) return;
                        entryByColor.set(label.toUpperCase(), {
                            participantId: entry.participant_id ?? null,
                            seed: entry.seed ?? null,
                            colorCode: rawColor,
                            name: entry.participant?.name,
                            country: entry.participant?.country,
                        });
                    });

                    const interferenceCalls = await fetchInterferenceCalls(currentHeatId);
                    const effectiveInterferences = computeEffectiveInterferences(interferenceCalls, Math.max(config.judges.length, 1));
                    const stats = calculateSurferStats(scores, config.surfers, config.judges.length, config.waves, false, effectiveInterferences)
                        .sort((a, b) => a.rank - b.rank);

                    const entryByRank = new Map<number, any>();
                    stats.forEach((stat) => {
                        const colorKey = stat.surfer.trim().toUpperCase();
                        const info = entryByColor.get(colorKey);
                        if (info) {
                            entryByRank.set(stat.rank, {
                                participantId: info.participantId,
                                seed: info.seed ?? null,
                                colorCode: info.colorCode ?? null,
                                colorLabel: colorKey,
                                name: info.name ?? stat.surfer,
                                country: info.country ?? undefined,
                            });
                        }
                    });

                    for (const heatMeta of sequence) {
                        const mappings = await fetchHeatSlotMappings(heatMeta.id);
                        if (!mappings.length) continue;

                        const targetColorOrder = (heatMeta.color_order ?? []).map((c: string) => c?.toUpperCase?.() ?? '');
                        const updates: any[] = [];
                        const cacheEntries: Record<string, any> = {};

                        const parseSourceFromPlaceholder = (placeholder?: string | null) => {
                            const normalized = (placeholder || '').toUpperCase().trim();
                            if (!normalized) return null;
                            const direct = normalized.match(/R(P?)(\d+)-H(\d+)-P(\d+)/);
                            if (direct) return { round: Number(direct[2]), heat: Number(direct[3]), position: Number(direct[4]) };
                            const displayStyle = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)\s*\(P\s*(\d+)\)/);
                            if (displayStyle) return { round: Number(displayStyle[1]), heat: Number(displayStyle[2]), position: Number(displayStyle[3]) };
                            const loose = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)\s*[- ]?\s*P\s*(\d+)/);
                            if (loose) return { round: Number(loose[1]), heat: Number(loose[2]), position: Number(loose[3]) };
                            return null;
                        };

                        mappings.forEach((mapping: any) => {
                            const parsed = parseSourceFromPlaceholder(mapping.placeholder);
                            const sourceRound = parsed?.round ?? mapping.source_round;
                            const sourceHeat = parsed?.heat ?? mapping.source_heat;
                            const rank = parsed?.position ?? mapping.source_position ?? null;

                            if (sourceRound !== config.round || sourceHeat !== config.heatId) return;
                            if (!rank) return;
                            const qualifier = entryByRank.get(rank);
                            if (!qualifier) return;

                            const targetColorCode = targetColorOrder[mapping.position - 1] || getFallbackColorForPosition(mapping.position);
                            updates.push({
                                position: mapping.position,
                                participant_id: qualifier.participantId,
                                seed: qualifier.seed ?? mapping.position,
                                color: targetColorCode,
                            });

                            if (targetColorCode) {
                                cacheEntries[targetColorCode.toUpperCase()] = {
                                    name: qualifier.name,
                                    country: qualifier.country,
                                };
                            }
                        });

                        if (updates.length) {
                            try {
                                await replaceHeatEntries(heatMeta.id, updates);
                                colorCache[heatMeta.id] = {
                                    ...(colorCache[heatMeta.id] ?? {}),
                                    ...cacheEntries,
                                };
                                colorCacheChanged = true;
                            } catch (error) {
                                console.warn(`Impossible de mettre à jour les participants du heat ${heatMeta.id}`, error);
                            }
                        }
                    }
                }
                } catch (error) {
                    console.warn('Impossible de préparer les qualifiés', error);
                }
            } else {
                console.warn('⚠️ Aucune note valide sur le heat courant: propagation des qualifiés ignorée.');
            }
        }

        // 4. Determine Next Heat
        let nextRound = config.round;
        let nextHeatNumber = config.heatId;
        let nextCandidate: any = null;

        if (sequence.length) {
            const currentIndex = sequence.findIndex((item: any) => ensureHeatId(item.id) === currentHeatId);
            if (currentIndex >= 0) {
                nextCandidate = sequence.slice(currentIndex + 1).find((item: any) => item.status !== 'closed') ?? null;
                if (nextCandidate) {
                    nextRound = nextCandidate.round;
                    nextHeatNumber = nextCandidate.heat_number;
                }
            }
        }

        // No automatic division switch: chief judge chooses next division manually from dropdown.
        const nextDivision = config.division;
        if (!nextCandidate) {
            console.log(`✅ Division ${config.division} terminée (ou aucun heat ouvert restant dans cette division)`);
            setTimeout(() => {
                alert(
                    `✅ Division ${config.division.toUpperCase()} terminée.\n\n` +
                    `Sélectionnez la prochaine division manuellement dans le menu déroulant.`
                );
            }, 500);
        }

        const advanced = nextRound !== config.round || nextHeatNumber !== config.heatId;

        // Additional validation: if we think we're advancing, make sure the next heat actually exists
        if (advanced && nextCandidate) {
            console.log(`✅ Progression validée: R${config.round}H${config.heatId} → R${nextRound}H${nextHeatNumber}`);
        } else if (advanced && !nextCandidate) {
            // This shouldn't happen - if advanced is true but no next candidate, something is wrong
            console.warn(`⚠️ ATTENTION: Tentative d'avancer sans heat suivant validé. Maintien sur R${config.round}H${config.heatId}`);
            nextRound = config.round;
            nextHeatNumber = config.heatId;
        } else {
            console.log(`🏁 Fin de l'événement - Aucun heat suivant`);
        }

        let nextSurfers = config.surfers;
        let nextSurfersPerHeat = config.surfersPerHeat;
        let nextSurferNames: Record<string, string> = { ...(config.surferNames ?? {}) };
        let nextSurferCountries: Record<string, string> = { ...(config.surferCountries ?? {}) };

        if (nextCandidate && Array.isArray(nextCandidate.color_order) && nextCandidate.color_order.length) {
            const normalizedColors = nextCandidate.color_order
                .map((color: any) => color?.toString()?.toUpperCase() ?? '')
                .filter((value: any): value is string => Boolean(value));

            const mappedSurfers = normalizedColors.map((color: string) => {
                const heatColor = color as HeatColor;
                return colorLabelMap[heatColor] ?? color;
            });

            if (mappedSurfers.length) {
                nextSurfers = mappedSurfers;
                nextSurfersPerHeat = nextCandidate.heat_size ?? mappedSurfers.length;
            }
        }

        const nextHeatKeyCandidate = nextCandidate ? ensureHeatId(nextCandidate.id) : null;
        if (nextHeatKeyCandidate && isSupabaseConfigured()) {
            try {
                const nextHeatEntriesRaw = await fetchHeatEntriesWithParticipants(nextHeatKeyCandidate);
                const nextHeatEntries = normalizeHeatEntries(nextHeatEntriesRaw);
                const inferredNames: Record<string, string> = {};
                const inferredCountries: Record<string, string> = {};

                nextHeatEntries.forEach((entry) => {
                    const rawColor = entry.color ? entry.color.toUpperCase() : '';
                    const label = rawColor ? colorLabelMap[(rawColor as HeatColor)] ?? rawColor : '';
                    if (!label) return;
                    const participant = Array.isArray(entry.participant) ? entry.participant[0] : entry.participant;

                    if (participant?.name) {
                        inferredNames[label] = participant.name;
                    }
                    if (participant?.country) {
                        inferredCountries[label] = participant.country;
                    }
                });

                if (Object.keys(inferredNames).length > 0) {
                    nextSurferNames = { ...nextSurferNames, ...inferredNames };
                }
                if (Object.keys(inferredCountries).length > 0) {
                    nextSurferCountries = { ...nextSurferCountries, ...inferredCountries };
                }
            } catch (error) {
                console.warn('Impossible de précharger les participants du heat suivant', error);
            }
        }

        // 5. Update Config & State
        if (colorCacheChanged && typeof window !== 'undefined') {
            localStorage.setItem(HEAT_COLOR_CACHE_KEY, JSON.stringify(colorCache));
        }

        const newConfig: AppConfig = advanced
            ? {
                ...config,
                division: nextDivision,
                round: nextRound,
                heatId: nextHeatNumber,
                surfers: nextSurfers,
                surfersPerHeat: nextSurfersPerHeat,
                surferNames: nextSurferNames,
                surferCountries: nextSurferCountries,
            }
            : { ...config };


        setConfig(newConfig);
        persistConfig(newConfig);
        setHeatStatus(advanced ? 'waiting' : 'finished');

        // Keep kiosk/tablets aligned with the newly selected heat.
        if (advanced && isSupabaseConfigured() && supabase && newConfig.competition) {
            try {
                const nextHeatPointer = getHeatIdentifiers(
                    newConfig.competition,
                    newConfig.division,
                    newConfig.round,
                    newConfig.heatId
                ).normalized;

                await supabase.from('active_heat_pointer').upsert({
                    event_name: newConfig.competition,
                    active_heat_id: nextHeatPointer,
                    updated_at: new Date().toISOString(),
                }, {
                    onConflict: 'event_name',
                });

                console.log('✅ active_heat_pointer mis à jour:', nextHeatPointer);
            } catch (error) {
                console.warn('⚠️ Impossible de mettre à jour active_heat_pointer:', error);
            }
        }

        // Save config to database for realtime sync to Display/Judge
        if (activeEventId) {
            try {
                await eventRepository.saveEventConfigSnapshot({
                    eventId: Number(activeEventId),
                    eventName: newConfig.competition,
                    division: newConfig.division,
                    round: newConfig.round,
                    heatNumber: newConfig.heatId,
                    judges: (newConfig.judges || []).map(id => ({
                        id,
                        name: newConfig.judgeNames?.[id] || id
                    })),
                    surfers: newConfig.surfers || [],
                    surferNames: newConfig.surferNames || {},
                    surferCountries: newConfig.surferCountries || {}
                });
                console.log('✅ Config synced to DB for realtime updates');
            } catch (error) {
                console.warn('⚠️ Failed to sync config to DB:', error);
            }
        }


        resetTimer(); // This resets timer state and publishes reset
        setScores([]);
        localStorage.setItem('surfJudgingScores', JSON.stringify([]));

        // 6. Create/Sync Next Heat
        const nextHeatIdentifiers = getHeatIdentifiers(
            newConfig.competition,
            newConfig.division,
            newConfig.round,
            newConfig.heatId
        );
        const nextHeatKey = nextHeatIdentifiers.normalized;

        try {
            await publishConfigUpdate(currentHeatId, newConfig); // Inform current heat subscribers

            // Always ensure next heat row exists before saving dependent tables (heat_configs/realtime).
            // createHeat uses upsert, so calling it systematically is safe and idempotent.
            await createHeat({
                competition: newConfig.competition,
                division: newConfig.division,
                round: newConfig.round,
                heat_number: newConfig.heatId,
                status: 'open',
                surfers: newConfig.surfers.map((surfer) => ({
                    color: surfer,
                    name: surfer,
                    country: 'SENEGAL',
                })),
            });

            await saveHeatConfig(nextHeatKey, newConfig);
            await saveTimerState(nextHeatKey, { isRunning: false, startTime: null, duration: DEFAULT_TIMER_DURATION });
            await publishConfigUpdate(nextHeatKey, newConfig);
            await publishTimerReset(nextHeatKey, DEFAULT_TIMER_DURATION);

        } catch (error) {
            console.log('⚠️ Synchronisation du nouveau heat différée:', error);
        }

        if (advanced) {
            console.log(`🏁 Heat ${config.heatId} fermé, passage au heat R${newConfig.round}H${newConfig.heatId}`);
        } else {
            console.log('🏁 Heat fermé. Aucun autre heat planifié.');
        }

    }, [
        config,
        currentHeatId,
        activeEventId,
        scores,
        judgeWorkCount,
        setHeatStatus,
        setJudgeWorkCount,
        setConfig,
        persistConfig,
        setScores,
        resetTimer,
        publishTimerPause,
        updateHeatStatus,
        markHeatFinished,
        createHeat,
        saveHeatConfig,
        saveTimerState,
        publishConfigUpdate,
        publishTimerReset
    ]);

    return {
        closeHeat
    };
}
