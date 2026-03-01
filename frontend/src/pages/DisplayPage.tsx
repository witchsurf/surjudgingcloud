import { useEffect, useMemo, useRef, useState } from 'react';
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

const mergeLiveHeatNames = (
    existing: Record<string, string> | undefined,
    incoming: Record<string, string> | undefined,
    surfers: string[] | undefined,
    source: 'entries' | 'mappings' | 'empty'
) => {
    if (source === 'empty') return existing || {};
    const merged = { ...(existing || {}) };
    const normalizedIncoming = normalizeSurferMap(incoming || {});
    const targetSurfers = (surfers || []).map((s) => normalizeColorCode(s) || s);

    targetSurfers.forEach((color) => {
        if (normalizedIncoming[color] !== undefined) {
            // Always trust current-heat payload (even placeholders) over previous heat names.
            merged[color] = normalizedIncoming[color];
        } else if (!merged[color]) {
            merged[color] = color;
        }
    });

    return merged;
};

const normalizePlaceholderKey = (value: string) =>
    value
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[()[\]]/g, ' ')
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

const normalizeScores = (scores: Score[]) => scores.map(score => {
    const s = normalizeColorCode(score.surfer) || (score.surfer || '').trim().toUpperCase();
    const j = normalizeJudgeId(score.judge_id) || (score.judge_id || '').trim().toUpperCase();
    return {
        ...score,
        surfer: s,
        judge_id: j,
        judge_name: normalizeJudgeName(score.judge_name) || score.judge_name,
        division: normalizeDivision(score.division) || (score.division || '').trim().toUpperCase()
    };
});

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
    const { config, configSaved, activeEventId, setConfig, initializeFromUrl } = useConfigStore();
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
    const configRef = useRef(config);
    const countriesRef = useRef(liveHeatCountries);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    useEffect(() => {
        countriesRef.current = liveHeatCountries;
    }, [liveHeatCountries]);

    // Initialize from URL on mount
    useEffect(() => {
        initializeFromUrl();
    }, [initializeFromUrl]);

    // Fetch available heats on mount or when activeEventId changes
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
                                const configuredJudgeCount = Math.max(config.judges.length, 1);
                                const stats = calculateSurferStats(
                                    normalizedScores,
                                    surfers,
                                    configuredJudgeCount,
                                    config.waves,
                                    false
                                );

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

            const historyJudges = config.judges.length > 0 ? config.judges : uniqueJudgeIds;
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
                judges: historyJudges,
                judgeNames: {
                    ...(config.judgeNames || {}),
                    ...inferredJudgeNames
                },
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

    const liveDisplayConfig = useMemo(() => {
        const mergedNames = mergeLiveHeatNames(
            config.surferNames,
            heatParticipants,
            config.surfers,
            heatParticipantsSource
        );
        const countries = Object.keys(liveHeatCountries).length > 0
            ? liveHeatCountries
            : (config.surferCountries || {});

        return normalizeConfig({
            ...config,
            surferNames: mergedNames,
            surferCountries: countries,
        } as AppConfig);
    }, [config, heatParticipants, liveHeatCountries, heatParticipantsSource]);

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
            const mergedNames = mergeLiveHeatNames(
                prev.surferNames,
                heatParticipants,
                prev.surfers,
                heatParticipantsSource
            );
            if (heatParticipantsSource === 'entries') {
                return {
                    ...prev,
                    surferNames: mergedNames,
                    surferCountries: liveHeatCountries
                };
            }

            if (heatParticipantsSource === 'mappings') {
                return {
                    ...prev,
                    surferNames: mergedNames,
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
                    const currentConfig = configRef.current;
                    const currentCountries = countriesRef.current;
                    const heatChanged = snapshot.heat_number !== currentConfig.heatId;
                    const roundChanged = snapshot.round !== currentConfig.round;

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
                            const snapshotCountries = normalizeSurferCountries(snapshot.surferCountries || {});
                            const mergedCountries = Object.keys(currentCountries).length > 0
                                ? currentCountries
                                : (Object.keys(snapshotCountries).length > 0 ? snapshotCountries : (prev.surferCountries || {}));

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
    }, [activeEventId]); // Keep a single subscription per event

    // Subscribe to realtime heat timer/config and scores
    useEffect(() => {
        if (viewMode !== 'live' || !configSaved || !config.competition) {
            // Return a no-op cleanup function to prevent React error #310
            return () => { };
        }

        // Charger les scores initiaux pour le heat courant
        setScores([]); // Reset scores immédiatement pour éviter de montrer des scores périmés
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
                } else if (fetched && fetched.length === 0) {
                    setScores([]); // On vide si aucun score n'est retourné
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
            const normalizedNew = normalizeScores([newScore])[0];
            const otherScores = currentScores.filter(s =>
                !(s.judge_id === normalizedNew.judge_id &&
                    s.surfer === normalizedNew.surfer &&
                    s.wave_number === normalizedNew.wave_number)
            );
            
            setScores([...otherScores, normalizedNew]);
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
        <div className="min-h-screen bg-primary-50 font-sans selection:bg-cta-100">
            {/* HISTORY NAVIGATION BAR */}
            <header className="bg-primary-900 border-b-4 border-primary-950 p-4 sticky top-0 z-50 shadow-block">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                    
                    {/* Mode Indicator & Brand */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                             <div className="p-1.5 bg-cta-500 rounded-lg border border-primary-950">
                                <History className="w-4 h-4 text-white" />
                             </div>
                             <h2 className="text-xl font-bebas tracking-wider text-white">
                                 HEAT <span className="text-cta-500">HISTORY</span>
                             </h2>
                        </div>

                        {viewMode === 'live' ? (
                            <div className="flex items-center gap-2 px-3 py-1 bg-success-500 text-white text-[10px] font-bold rounded-full border-2 border-primary-950 animate-pulse uppercase tracking-widest">
                                <div className="w-1.5 h-1.5 rounded-full bg-white" /> DIRECT
                            </div>
                        ) : (
                            <button
                                onClick={handleReturnToLive}
                                className="flex items-center gap-2 px-3 py-1 bg-cta-500 text-white text-[10px] font-bold rounded-full border-2 border-primary-950 hover:bg-cta-600 transition-all uppercase tracking-widest shadow-sm"
                            >
                                <RotateCcw className="w-3 h-3" />
                                RETOUR AU DIRECT
                            </button>
                        )}
                    </div>

                    {/* Past Results Dropdown */}
                    <div className="relative w-full sm:w-auto min-w-[300px]">
                        <div className="relative group">
                            <select
                                className="w-full bg-white border-2 border-primary-950 rounded-xl px-4 py-2.5 text-sm font-bold text-primary-900 appearance-none cursor-pointer focus:ring-0 shadow-block hover:-translate-y-0.5 transition-all"
                                value={selectedHistoryHeatId || ""}
                                onChange={(e) => handleHeatSelect(e.target.value)}
                                disabled={isLoadingHistory}
                            >
                                <option value="" disabled className="text-primary-300">📅 HISTORIQUE DES HEATS...</option>
                                {Object.entries(historyHeats).map(([category, rounds]) => (
                                    <optgroup key={category} label={category} className="font-bebas text-lg tracking-wide bg-primary-50">
                                        {rounds.flatMap(round =>
                                            round.heats.map(heat => (
                                                <option key={heat.heatId} value={heat.heatId} className="font-sans text-sm">
                                                    {round.name} - Heat {heat.heatNumber}
                                                </option>
                                            ))
                                        )}
                                    </optgroup>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-400 pointer-events-none" />
                        </div>
                    </div>
                </div>
            </header>

            {/* CONTENT AREA */}
            <main className="flex-grow py-8 px-4">
                <div className="max-w-7xl mx-auto">
                    {viewMode === 'live' ? (
                        <ScoreDisplay
                            config={liveDisplayConfig}
                            scores={scores}
                            timer={timer}
                            configSaved={configSaved}
                            heatStatus={heatStatus}
                        />
                    ) : (
                        <div className="space-y-6">
                            {historyConfig && (
                                <div className="relative animate-fade-in">
                                    {/* ARCHIVE BANNER */}
                                    <div className="flex justify-center mb-8">
                                        <div className="bg-primary-900 border-4 border-primary-950 px-6 py-2 rounded-2xl shadow-block-orange inline-flex flex-col items-center">
                                            <span className="text-cta-500 font-bebas text-2xl tracking-[0.3em]">ARCHIVE</span>
                                            <span className="text-white text-[10px] font-bold uppercase tracking-widest opacity-60">Consultation uniquement</span>
                                        </div>
                                    </div>
                                    
                                    <ScoreDisplay
                                        config={historyConfig}
                                        scores={historyScores}
                                        timer={{ isRunning: false, startTime: null, duration: 0 }}
                                        configSaved={true}
                                        heatStatus="finished"
                                    />
                                </div>
                            )}

                            {isLoadingHistory && (
                                <div className="flex flex-col items-center justify-center py-32 space-y-6">
                                    <div className="relative w-16 h-16">
                                        <div className="absolute inset-0 border-4 border-primary-200 rounded-full" />
                                        <div className="absolute inset-0 border-4 border-cta-500 rounded-full border-t-transparent animate-spin" />
                                    </div>
                                    <p className="font-bebas text-2xl text-primary-900 tracking-widest animate-pulse">
                                        Chargement du Heat...
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
