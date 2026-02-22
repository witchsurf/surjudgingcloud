import { useEffect, useMemo, useState } from 'react';
import { History, ChevronDown, RotateCcw } from 'lucide-react';
import ScoreDisplay from '../components/ScoreDisplay';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import {
    fetchEventConfigSnapshot,
    fetchAllEventHeats,
    fetchAllScoresForEvent,
    fetchHeatMetadata,
    fetchHeatScores,
    fetchHeatEntriesWithParticipants
} from '../api/supabaseClient';
import { supabase } from '../lib/supabase';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useSupabaseSync } from '../hooks/useSupabaseSync';
import { useHeatParticipants } from '../hooks/useHeatParticipants';
import { getHeatIdentifiers } from '../utils/heat';
import { calculateSurferStats } from '../utils/scoring';
import { colorLabelMap } from '../utils/colorUtils';
import type { AppConfig, Score } from '../types';
import type { RoundSpec } from '../utils/bracket';

const COLOR_MAP: Record<string, string> = {
    RED: 'ROUGE',
    WHITE: 'BLANC',
    YELLOW: 'JAUNE',
    BLUE: 'BLEU',
    GREEN: 'VERT',
    ROUGE: 'ROUGE',
    BLANC: 'BLANC',
    JAUNE: 'JAUNE',
    BLEU: 'BLEU',
    VERT: 'VERT'
};

const normalizeColorCode = (color?: string) => {
    if (!color) return undefined;
    const upper = color.toUpperCase();
    return COLOR_MAP[upper] ?? upper;
};

const normalizeDivision = (division?: string) => {
    if (!division) return division;
    const upper = division.trim().toUpperCase();
    if (upper === 'GIRL OPEN') return 'GIRLS OPEN';
    return upper;
};

const normalizeJudgeId = (id?: string) => {
    if (!id) return id;
    const upper = id.toUpperCase();
    if (upper === 'KIOSK-J1') return 'J1';
    if (upper === 'KIOSK-J2') return 'J2';
    if (upper === 'KIOSK-J3') return 'J3';
    return upper;
};

const normalizeJudgeName = (name?: string) => {
    if (!name) return name;
    const upper = name.toUpperCase();
    if (upper === 'KIOSK-J1') return 'J1';
    if (upper === 'KIOSK-J2') return 'J2';
    if (upper === 'KIOSK-J3') return 'J3';
    return name;
};

const normalizeCountry = (country?: string) => {
    if (!country) return country;
    return country.toUpperCase();
};

const normalizeSurferMap = (map?: Record<string, string>) => {
    if (!map) return map || {};
    return Object.entries(map).reduce<Record<string, string>>((acc, [key, value]) => {
        const normalizedKey = normalizeColorCode(key);
        if (normalizedKey) acc[normalizedKey] = value;
        return acc;
    }, {});
};

const normalizeSurferCountries = (map?: Record<string, string>) => {
    if (!map) return map || {};
    return Object.entries(map).reduce<Record<string, string>>((acc, [key, value]) => {
        const normalizedKey = normalizeColorCode(key);
        if (normalizedKey) acc[normalizedKey] = normalizeCountry(value) || value;
        return acc;
    }, {});
};

const isLikelyPlaceholder = (name?: string) => {
    if (!name) return false;
    const normalized = name.toUpperCase().trim();
    return normalized.includes('QUALIFI') ||
        normalized.includes('FINALISTE') ||
        normalized.includes('REPECH') ||
        normalized.startsWith('R') ||
        normalized.startsWith('RP') ||
        normalized.startsWith('POSITION') ||
        normalized === 'BYE';
};

const mergeSurferNames = (
    existing: Record<string, string> | undefined,
    incoming: Record<string, string> | undefined
) => {
    const mergedNames = { ...(existing || {}) };
    Object.entries(incoming || {}).forEach(([color, incomingName]) => {
        const currentName = mergedNames[color];
        const currentIsReal = Boolean(currentName) && !isLikelyPlaceholder(currentName);
        const incomingIsPlaceholder = isLikelyPlaceholder(incomingName);

        if (currentIsReal && incomingIsPlaceholder) {
            return;
        }
        mergedNames[color] = incomingName;
    });
    return mergedNames;
};

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

const resolveFromQualifierMap = (text: string, qualifierMap: Map<string, string>) => {
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

const normalizeScores = (scores: Score[]) => scores.map(score => ({
    ...score,
    surfer: normalizeColorCode(score.surfer) || score.surfer,
    judge_id: normalizeJudgeId(score.judge_id) || score.judge_id,
    judge_name: normalizeJudgeName(score.judge_name) || score.judge_name,
    division: normalizeDivision(score.division) || score.division
}));

const normalizeConfig = (appConfig: AppConfig) => {
    const normalizedJudges = (appConfig.judges || []).map((judge) =>
        typeof judge === 'string' ? normalizeJudgeId(judge) || judge : judge
    ) as string[];

    const normalizedJudgeNames = Object.entries(appConfig.judgeNames || {}).reduce<Record<string, string>>(
        (acc, [key, value]) => {
            const normalizedKey = normalizeJudgeId(key);
            if (normalizedKey) acc[normalizedKey] = normalizeJudgeName(value) || value;
            return acc;
        },
        {}
    );

    return {
        ...appConfig,
        division: normalizeDivision(appConfig.division) || appConfig.division,
        surfers: (appConfig.surfers || []).map((surfer) => normalizeColorCode(surfer) || surfer),
        surferNames: normalizeSurferMap(appConfig.surferNames || {}),
        surferCountries: normalizeSurferCountries(appConfig.surferCountries || {}),
        judges: normalizedJudges,
        judgeNames: normalizedJudgeNames,
    };
};

export default function DisplayPage() {
    const { config, configSaved, activeEventId, setConfig } = useConfigStore();
    const { scores, timer, setTimer, heatStatus, setHeatStatus, setScores } = useJudgingStore();
    const { subscribeToHeat } = useRealtimeSync();
    const { loadScoresFromDatabase } = useSupabaseSync();

    // -- HISTORY MODE STATE --
    const [viewMode, setViewMode] = useState<'live' | 'history'>('live');
    const [historyHeats, setHistoryHeats] = useState<Record<string, RoundSpec[]>>({});
    const [selectedHistoryHeatId, setSelectedHistoryHeatId] = useState<string | null>(null);
    const [historyConfig, setHistoryConfig] = useState<AppConfig | null>(null);
    const [historyScores, setHistoryScores] = useState<Score[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [liveHeatCountries, setLiveHeatCountries] = useState<Record<string, string>>({});

    // Fetch available heats on mount
    useEffect(() => {
        if (activeEventId) {
            fetchAllEventHeats(activeEventId).then(setHistoryHeats).catch(console.error);
        }
    }, [activeEventId]);

    const handleHeatSelect = async (heatId: string) => {
        if (!heatId || !activeEventId) return;

        setIsLoadingHistory(true);
        setSelectedHistoryHeatId(heatId);

        try {
            // 1. Fetch metadata (round, division, etc.)
            const metadata = await fetchHeatMetadata(heatId);
            if (!metadata) throw new Error("Heat metadata not found");

            // 2. Fetch surfers/participants
            const entries = await fetchHeatEntriesWithParticipants(heatId);
            const surfers = entries.map(e => e.color).filter(Boolean) as string[];
            const surferNames: Record<string, string> = {};
            const surferCountries: Record<string, string> = {};

            entries.forEach(e => {
                if (e.color && e.participant) {
                    if (e.participant.name) surferNames[e.color] = e.participant.name;
                    if (e.participant.country) surferCountries[e.color] = e.participant.country;
                }
            });

            // History fallback: resolve qualifier placeholders from division rounds + event scores
            const hasRealNames = Object.values(surferNames).some((name) => !isLikelyPlaceholder(name));
            if (!hasRealNames && activeEventId) {
                const divisionKey = Object.keys(historyHeats).find(
                    (key) => normalizeDivision(key) === normalizeDivision(metadata.division)
                );
                const divisionRounds = divisionKey ? historyHeats[divisionKey] : [];
                if (divisionRounds.length > 0) {
                    const rounds = JSON.parse(JSON.stringify(divisionRounds)) as RoundSpec[];
                    const allScores = await fetchAllScoresForEvent(activeEventId);
                    const qualifierMap = new Map<string, string>();

                    rounds
                        .sort((a, b) => a.roundNumber - b.roundNumber)
                        .forEach((round) => {
                            round.heats.forEach((heat) => {
                                heat.slots.forEach((slot) => {
                                    const candidate = slot.placeholder || slot.name;
                                    if (!candidate || !isLikelyPlaceholder(candidate)) return;
                                    const resolved = resolveFromQualifierMap(candidate, qualifierMap);
                                    if (resolved) {
                                        slot.name = resolved;
                                        slot.placeholder = undefined;
                                    }
                                });

                                if (!heat.heatId) return;
                                const heatScores = allScores[heat.heatId] ?? [];
                                if (!heatScores.length) return;

                                const namesByColor = heat.slots.reduce<Record<string, string>>((acc, slot) => {
                                    if (!slot.color || !slot.name || isLikelyPlaceholder(slot.name)) return acc;
                                    const label = colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color;
                                    const normalized = normalizeColorCode(label);
                                    if (normalized) acc[normalized] = slot.name;
                                    return acc;
                                }, {});
                                const surfers = Object.keys(namesByColor);
                                if (!surfers.length) return;

                                const normalizedScores = heatScores.map((score) => ({
                                    ...score,
                                    surfer: normalizeColorCode(score.surfer) || score.surfer
                                }));
                                const judgeCount = new Set(normalizedScores.map((s) => s.judge_id).filter(Boolean)).size;
                                const stats = calculateSurferStats(normalizedScores, surfers, Math.max(judgeCount, 1), 20, true);

                                stats
                                    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                                    .forEach((stat) => {
                                        const name = namesByColor[stat.surfer.toUpperCase()];
                                        if (!name) return;
                                        buildQualifierKeyVariants(round.roundNumber, heat.heatNumber, stat.rank)
                                            .forEach((key) => qualifierMap.set(normalizePlaceholderKey(key), name));
                                    });
                            });
                        });

                    const targetHeat = rounds
                        .flatMap((round) => round.heats)
                        .find((heat) => heat.heatId === heatId);

                    if (targetHeat) {
                        targetHeat.slots.forEach((slot) => {
                            const color = slot.color ? (normalizeColorCode(colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color) || slot.color) : '';
                            if (!color) return;
                            const candidate = slot.name || slot.placeholder;
                            if (!candidate) return;
                            const resolved = isLikelyPlaceholder(candidate)
                                ? resolveFromQualifierMap(candidate, qualifierMap)
                                : candidate;
                            if (resolved) surferNames[color] = resolved;
                        });
                    }
                }
            }

            // 3. Fetch scores
            const rawScores = await fetchHeatScores(heatId);

            // 4. Transform scores to expected format
            // (fetchHeatScores already returns Score[] format compatible with our store)

            // 5. Construct synthetic AppConfig
            const uniqueJudgeIds = Array.from(new Set(rawScores.map(s => s.judge_id))).filter(Boolean);
            const inferredJudgeNames: Record<string, string> = {};
            rawScores.forEach(s => {
                if (s.judge_id && s.judge_name) {
                    inferredJudgeNames[s.judge_id] = s.judge_name;
                }
            });

            const syntheticConfig: AppConfig = {
                ...config, // fallback to current config defaults
                competition: metadata.competition,
                division: metadata.division,
                round: metadata.round,
                heatId: metadata.heat_number,
                surfers: surfers.length > 0 ? surfers : config.surfers, // use actual heat surfers or fallback
                surferNames: surferNames,
                surferCountries: surferCountries,
                waves: config.waves, // Assuming wave count is constant per event or strictly failing back
                judges: uniqueJudgeIds,
                judgeNames: inferredJudgeNames,
            };

            setHistoryConfig(normalizeConfig(syntheticConfig));
            setHistoryScores(normalizeScores(rawScores));
            setViewMode('history');

        } catch (err) {
            console.error("Error loading history heat:", err);
            alert("Impossible de charger les résultats de ce heat.");
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const handleReturnToLive = () => {
        setViewMode('live');
        setSelectedHistoryHeatId(null);
        setHistoryConfig(null);
    };


    // -- LIVE MODE LOGIC --
    const currentHeatId = useMemo(
        () =>
            getHeatIdentifiers(
                config.competition,
                config.division,
                config.round,
                config.heatId
            ).normalized,
        [config.competition, config.division, config.round, config.heatId]
    );

    // Load participant names for current heat
    const { participants: heatParticipants, source: heatParticipantsSource } = useHeatParticipants(currentHeatId);

    useEffect(() => {
        let cancelled = false;

        const loadLiveHeatCountries = async () => {
            try {
                const entries = await fetchHeatEntriesWithParticipants(currentHeatId);
                if (cancelled) return;

                const countries = entries.reduce<Record<string, string>>((acc, entry) => {
                    const color = normalizeColorCode(entry.color || undefined);
                    const country = normalizeCountry(entry.participant?.country || undefined);
                    if (!color || !country) return acc;
                    acc[color] = country;
                    return acc;
                }, {});

                setLiveHeatCountries(countries);
            } catch (error) {
                if (!cancelled) {
                    console.warn('Impossible de charger les pays du heat courant', error);
                    setLiveHeatCountries({});
                }
            }
        };

        loadLiveHeatCountries();
        return () => {
            cancelled = true;
        };
    }, [currentHeatId]);

    // Sync heat participants into config when they load
    useEffect(() => {
        setConfig(prev => {
            if (heatParticipantsSource === 'entries') {
                return {
                    ...prev,
                    surferNames: mergeSurferNames(prev.surferNames, heatParticipants),
                    surferCountries: liveHeatCountries
                };
            }

            if (heatParticipantsSource === 'mappings') {
                return {
                    ...prev,
                    surferNames: mergeSurferNames(prev.surferNames, heatParticipants),
                    surferCountries: liveHeatCountries
                };
            }

            // If we couldn't load entries/mappings yet, keep existing names to avoid flicker.
            return prev;
        });
    }, [heatParticipants, heatParticipantsSource, liveHeatCountries, setConfig]);

    const [isReloading, setIsReloading] = useState(false);

    // Subscribe to config changes for cross-device sync
    useEffect(() => {
        if (!activeEventId) return;

        const channel = supabase
            ?.channel(`event-config-${activeEventId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'event_last_config',
                filter: `event_id=eq.${activeEventId}`
            }, async () => {
                // Check if heat/round changed
                const snapshot = await fetchEventConfigSnapshot(activeEventId);
                if (snapshot) {
                    const heatChanged = snapshot.heat_number !== config.heatId;
                    const roundChanged = snapshot.round !== config.round;

                    if (heatChanged || roundChanged) {
                        setIsReloading(true);
                        // Force reload to ensure clean state
                        setTimeout(() => window.location.reload(), 100);
                        return;
                    }

                    // Minor config changes only - update without reload
                    try {
                        setConfig((prev) => {
                            const snapshotNames = normalizeSurferMap(snapshot.surferNames || {});
                            const mergedNames = mergeSurferNames(prev.surferNames, snapshotNames);
                            const mergedCountries = {
                                ...(prev.surferCountries || {}),
                                ...normalizeSurferCountries(snapshot.surferCountries || {})
                            };

                            const newConfig = {
                                ...prev,
                                competition: snapshot.event_name || prev.competition || '',
                                division: snapshot.division || prev.division || 'OPEN',
                                round: snapshot.round || prev.round || 1,
                                heatId: snapshot.heat_number || prev.heatId || 1,
                                judges: snapshot.judges?.map(j => j.id) || prev.judges || [],
                                judgeNames: snapshot.judges?.reduce((acc, j) => ({ ...acc, [j.id]: j.name || j.id }), {}) || prev.judgeNames || {},
                                surfers: snapshot.surfers || prev.surfers,
                                surferNames: mergedNames,
                                surferCountries: mergedCountries,
                                surfersPerHeat: snapshot.surfers?.length || prev.surfersPerHeat || 4,
                                waves: prev.waves,
                                tournamentType: prev.tournamentType,
                                totalSurfers: prev.totalSurfers,
                                totalHeats: prev.totalHeats,
                                totalRounds: prev.totalRounds
                            };
                            return normalizeConfig(newConfig as AppConfig);
                        });
                    } catch (error) {
                        console.error('❌ Display: failed to update config:', error);
                    }
                }
            })
            .subscribe();

        return () => {
            if (channel) {
                supabase?.removeChannel(channel);
            }
        };
    }, [activeEventId, config.heatId, config.round]); // Removed setConfig to prevent loop

    // Subscribe to realtime heat timer/config and scores
    useEffect(() => {
        // Only run real-time sync if we are in LIVE mode!
        // (Actually, we should arguably keep it running in background so switching back is instant, 
        // but let's keep logic simple: hooks run always, we just choose what to display)

        if (!configSaved || !config.competition) {
            // Return a no-op cleanup function to prevent React error #310
            return () => { };
        }

        // Charger les scores initiaux pour le heat courant
        loadScoresFromDatabase(currentHeatId).then((fetched) => {
            if (fetched && fetched.length) {
                setScores(normalizeScores(fetched));
            }
        });

        const unsubscribe = subscribeToHeat(currentHeatId, (nextTimer, nextConfig, status) => {
            setTimer(nextTimer);
            if (nextConfig) {
                setConfig((prev) => normalizeConfig({
                    ...prev,
                    ...nextConfig
                } as AppConfig));
            }
            if (status) setHeatStatus(status);

            // Recharger les scores en temps réel si le heat change
            loadScoresFromDatabase(currentHeatId).then((fetched) => {
                if (fetched && fetched.length) {
                    setScores(normalizeScores(fetched));
                }
            });
        });

        // Écouter les scores en temps réel (INSERT/UPDATE)
        const handleNewScore = (event: Event) => {
            const customEvent = event as CustomEvent;
            const newScore = customEvent.detail;

            // Mettre à jour le store avec le nouveau score
            // On utilise la forme fonctionnelle pour garantir l'état le plus récent
            // Note: useJudgingStore.getState().scores pourrait être une alternative si setScores ne supporte pas le callback
            // Mais ici on suppose que setScores remplace tout. On doit fusionner.
            const currentScores = useJudgingStore.getState().scores;

            // Fusionner: supprimer l'ancien score pour ce juge/surfeur/vague s'il existe
            const otherScores = currentScores.filter(s =>
                !(s.judge_id === newScore.judge_id &&
                    s.surfer === newScore.surfer &&
                    s.wave_number === newScore.wave_number)
            );

            setScores(normalizeScores([...otherScores, newScore]));
        };

        window.addEventListener('newScoreRealtime', handleNewScore);

        return () => {
            unsubscribe();
            window.removeEventListener('newScoreRealtime', handleNewScore);
        };
    }, [configSaved, config.competition, currentHeatId, subscribeToHeat, setTimer, setConfig, setHeatStatus, loadScoresFromDatabase, setScores]);

    if (isReloading) return null;

    // -- RENDER --
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* HISTORY NAVIGATION BAR - Always visible on Display Page */}
            <div className="bg-slate-900 border-b border-slate-700 shadow-md p-4 sticky top-0 z-50">
                <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">

                    {/* Mode Indicator */}
                    <div className="flex items-center space-x-3">
                        {viewMode === 'live' ? (
                            <div className="flex items-center px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse">
                                <span className="mr-1">●</span> DIRECT
                            </div>
                        ) : (
                            <button
                                onClick={handleReturnToLive}
                                className="flex items-center px-3 py-1 bg-gray-700 text-gray-300 text-xs font-bold rounded-full hover:bg-gray-600 transition-colors"
                            >
                                <RotateCcw className="w-3 h-3 mr-1" />
                                RETOUR AU DIRECT
                            </button>
                        )}
                    </div>

                    {/* Past Results Dropdown */}
                    <div className="relative group w-full sm:w-auto">
                        <div className="flex items-center bg-slate-800 rounded-lg border border-slate-600 px-3 py-2 text-slate-300 w-full sm:min-w-[280px]">
                            <History className="w-4 h-4 mr-2 opacity-50" />
                            <select
                                className="bg-transparent border-none outline-none text-sm w-full appearance-none cursor-pointer"
                                value={selectedHistoryHeatId || ""}
                                onChange={(e) => handleHeatSelect(e.target.value)}
                                disabled={isLoadingHistory}
                            >
                                <option value="" disabled>📅 Consulter un résultat passé...</option>
                                {Object.entries(historyHeats).map(([category, rounds]) => (
                                    <optgroup key={category} label={category}>
                                        {rounds.flatMap(round =>
                                            round.heats.map(heat => (
                                                <option key={heat.heatId} value={heat.heatId}>
                                                    {round.name} - Heat {heat.heatNumber}
                                                </option>
                                            ))
                                        )}
                                    </optgroup>
                                ))}
                            </select>
                            <ChevronDown className="w-4 h-4 ml-2 opacity-50 pointer-events-none" />
                        </div>
                    </div>
                </div>
            </div>

            {/* CONTENT */}
            <div className="flex-grow pt-4">
                {viewMode === 'live' ? (
                    <ScoreDisplay
                        config={config}
                        scores={scores}
                        timer={timer}
                        configSaved={configSaved}
                        heatStatus={heatStatus}
                    />
                ) : (
                    <>
                        {historyConfig && (
                            <div className="relative">
                                {/* Banner for Archive Mode */}
                                <div className="absolute top-0 left-0 right-0 -mt-6 flex justify-center pointer-events-none">
                                    <span className="bg-slate-800 text-slate-400 text-[10px] px-3 py-0.5 rounded-b-lg font-mono uppercase tracking-widest">
                                        Archive
                                    </span>
                                </div>
                                <ScoreDisplay
                                    config={historyConfig}
                                    scores={historyScores}
                                    // Use a dummy finished timer for history
                                    timer={{ isRunning: false, startTime: null, duration: 0 }}
                                    configSaved={true}
                                    heatStatus="finished"
                                />
                            </div>
                        )}
                        {isLoadingHistory && (
                            <div className="text-center py-20 text-gray-500 flex flex-col items-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
                                Chargement des résultats...
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
