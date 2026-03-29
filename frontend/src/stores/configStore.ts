/**
 * Config Store (Zustand)
 * 
 * Manages application configuration with localStorage persistence and database sync.
 * Replaces the old ConfigContext for better performance.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppConfig } from '../types';
import { INITIAL_CONFIG } from '../utils/constants';
import { eventRepository, heatRepository } from '../repositories';
import { fetchAllEventCategories, fetchHeatEntriesWithParticipants, fetchActiveHeatPointer, fetchHeatMetadata, parseActiveHeatId, upsertActiveHeatPointer } from '../api/supabaseClient';
import { ensureHeatId, getHeatIdentifiers } from '../utils/heat';
import { resolveEventDisplayName } from '../utils/eventName';
import { logger } from '../lib/logger';
import type { EventConfigSnapshot } from '../repositories';
import { supabase } from '../lib/supabase';

interface ConfigStore {
    // State
    config: AppConfig;
    configSaved: boolean;
    activeEventId: number | null;
    availableDivisions: string[];
    loadedFromDb: boolean;
    isKioskMode: boolean;

    // Actions
    setConfig: (config: AppConfig | ((prev: AppConfig) => AppConfig)) => void;
    setConfigSaved: (saved: boolean) => void;
    setActiveEventId: (id: number | null) => void;
    setAvailableDivisions: (divisions: string[]) => void;
    setLoadedFromDb: (loaded: boolean) => void;
    setIsKioskMode: (isKiosk: boolean) => void;

    // Complex actions
    loadKioskConfig: () => Promise<void>;
    loadConfigFromDb: (eventId: number) => Promise<void>;
    persistConfig: (config: AppConfig) => void;
    resetConfig: () => void;
    initializeFromUrl: () => Promise<void>;
    saveConfigToDb: (eventId: number, config: AppConfig) => Promise<void>;
}

const configLoadInFlight = new Map<number, Promise<void>>();

// Helper to build config from snapshot
const buildConfigFromSnapshot = (snapshot: EventConfigSnapshot): AppConfig => {
    logger.debug('ConfigStore', 'Building config from snapshot', {
        surfers: snapshot.surfers,
        surferNames: snapshot.surferNames
    });

    return {
        competition: resolveEventDisplayName(snapshot.eventDetails?.name, snapshot.event_name),
        division: snapshot.division || 'OPEN',
        round: snapshot.round || 1,
        heatId: snapshot.heat_number || 1,
        judges: snapshot.judges?.map(j => j.id) || ['J1', 'J2', 'J3'],
        judgeNames: snapshot.judges?.reduce((acc, j) => ({ ...acc, [j.id]: j.name || j.id }), {}) || {},
        judgeIdentities: snapshot.judges?.reduce((acc, j) => {
            if (j.identityId) {
                acc[j.id] = j.identityId;
            }
            return acc;
        }, {} as Record<string, string>) || {},
        surfers: snapshot.surfers || ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
        surferNames: snapshot.surferNames || {},
        surferCountries: snapshot.surferCountries || {},
        surfersPerHeat: snapshot.surfers?.length || 4,
        waves: 15,
        tournamentType: 'elimination' as 'elimination' | 'repechage',
        totalSurfers: 0,
        totalHeats: 0,
        totalRounds: 1
    };
};

const applyHeatJudgeAssignments = async (config: AppConfig, heatId: string): Promise<AppConfig> => {
    try {
        const assignments = await heatRepository.fetchHeatJudgeAssignments(heatId);
        if (assignments.length === 0) {
            return config;
        }

        const sortedAssignments = [...assignments].sort((a, b) =>
            a.station.localeCompare(b.station, undefined, { numeric: true, sensitivity: 'base' })
        );

        const judgeNames = sortedAssignments.reduce<Record<string, string>>((acc, assignment) => {
            acc[assignment.station] = assignment.judge_name;
            return acc;
        }, {});
        const judgeIdentities = sortedAssignments.reduce<Record<string, string>>((acc, assignment) => {
            acc[assignment.station] = assignment.judge_id;
            return acc;
        }, {});

        return {
            ...config,
            judges: sortedAssignments.map((assignment) => assignment.station),
            judgeNames,
            judgeIdentities,
        };
    } catch (error) {
        logger.warn('ConfigStore', 'Unable to load heat judge assignments', { heatId, error });
        return config;
    }
};

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            // Initial state
            config: INITIAL_CONFIG,
            configSaved: false,
            activeEventId: null,
            availableDivisions: [],
            loadedFromDb: false,
            isKioskMode: false,

            // Basic setters
            setConfig: (config) => set((state) => ({
                config: typeof config === 'function' ? config(state.config) : config
            })),

            setConfigSaved: (saved) => set({ configSaved: saved }),

            setActiveEventId: (id) => set({ activeEventId: id }),

            setAvailableDivisions: (divisions) => set({ availableDivisions: divisions }),

            setLoadedFromDb: (loaded) => set({ loadedFromDb: loaded }),

            setIsKioskMode: (isKiosk) => set({ isKioskMode: isKiosk }),

            // Load config for kiosk mode
            loadKioskConfig: async () => {
                logger.info('ConfigStore', 'Loading kiosk config from active heat pointer');

                try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const urlEventId = urlParams.get('eventId');
                    const persistedEventId = get().activeEventId;
                    const eventIdCandidate = Number.isFinite(Number(urlEventId))
                        ? Number(urlEventId)
                        : (Number.isFinite(persistedEventId) && persistedEventId ? persistedEventId : null);

                    if (eventIdCandidate) {
                        set({ activeEventId: eventIdCandidate });
                        await get().loadConfigFromDb(eventIdCandidate);
                        return;
                    }

                    const activeHeat = await fetchActiveHeatPointer();

                    if (activeHeat) {
                        logger.info('ConfigStore', 'Active heat pointer found', activeHeat);
                        if (activeHeat.event_id) {
                            set({ activeEventId: activeHeat.event_id });
                            await get().loadConfigFromDb(activeHeat.event_id);
                            return;
                        }

                        const parsed = parseActiveHeatId(activeHeat.active_heat_id);

                        if (parsed) {
                            logger.info('ConfigStore', 'Parsed heat config', parsed);

                            let eventId = activeHeat.event_id ?? null;
                            if (!eventId) {
                                const heatMetadata = await fetchHeatMetadata(activeHeat.active_heat_id);
                                eventId = heatMetadata?.event_id ?? null;
                            }
                            if (!eventId) {
                                eventId = await eventRepository.fetchEventIdByName(parsed.competition);
                            }
                            if (eventId) {
                                set({ activeEventId: eventId });
                                await get().loadConfigFromDb(eventId);
                                return;
                            }

                            const nextHeatId = ensureHeatId(activeHeat.active_heat_id);
                            const nextConfig = await applyHeatJudgeAssignments({
                                ...INITIAL_CONFIG,
                                competition: resolveEventDisplayName(parsed.competition, parsed.competition),
                                division: parsed.division,
                                round: parsed.round,
                                heatId: parsed.heatNumber
                            }, nextHeatId);

                            set({
                                config: nextConfig,
                                configSaved: true,
                                loadedFromDb: true
                            });
                        }
                    } else {
                        logger.warn('ConfigStore', 'No active heat pointer found');
                    }
                } catch (err) {
                    logger.error('ConfigStore', 'Kiosk config load error', err);
                }
            },

            // Load config from database
            loadConfigFromDb: async (eventId: number) => {
                const existingLoad = configLoadInFlight.get(eventId);
                if (existingLoad) {
                    logger.debug('ConfigStore', 'Reusing in-flight config load', { eventId });
                    return existingLoad;
                }

                const loadPromise = (async () => {
                    logger.info('ConfigStore', 'Fetching config from database', { eventId });

                    try {
                        // Use EventRepository instead of supabaseClient
                        let snapshot = await eventRepository.fetchEventConfigSnapshot(eventId);

                        // Fallback: enrich snapshot with lineup names if missing
                        if (snapshot && (!snapshot.surferNames || Object.keys(snapshot.surferNames).length === 0)) {
                            try {
                                const heatKey = ensureHeatId(
                                    `${snapshot.event_name}_${snapshot.division}_R${snapshot.round}_H${snapshot.heat_number}`
                                );
                                const entries = await fetchHeatEntriesWithParticipants(heatKey);
                                const surferNames: Record<string, string> = {};
                                const surferCountries: Record<string, string> = {};

                                entries.forEach((entry) => {
                                    const color = entry.color?.toUpperCase();
                                    if (!color) return;
                                    if (entry.participant?.name) {
                                        surferNames[color] = entry.participant.name;
                                    }
                                    if (entry.participant?.country) {
                                        surferCountries[color] = entry.participant.country;
                                    }
                                });

                                snapshot = {
                                    ...snapshot,
                                    surferNames: Object.keys(surferNames).length ? surferNames : snapshot.surferNames,
                                    surferCountries: Object.keys(surferCountries).length
                                        ? { ...snapshot.surferCountries, ...surferCountries }
                                        : snapshot.surferCountries,
                                };
                            } catch (err) {
                                logger.warn('ConfigStore', 'Unable to enrich surfer names from heat entries', err);
                            }
                        }

                        // If active_heat_pointer is newer/different, prefer it for the active heat
                        if (snapshot?.event_name) {
                            try {
                                const activeHeat = await fetchActiveHeatPointer(eventId, snapshot.event_name);
                                if (activeHeat) {
                                    const parsed = parseActiveHeatId(activeHeat.active_heat_id);
                                    const snapshotUpdatedAt = snapshot.updated_at ? Date.parse(snapshot.updated_at) : NaN;
                                    const pointerUpdatedAt = activeHeat.updated_at ? Date.parse(activeHeat.updated_at) : NaN;
                                    const pointerIsNewer = Number.isFinite(pointerUpdatedAt)
                                        && (!Number.isFinite(snapshotUpdatedAt) || pointerUpdatedAt >= snapshotUpdatedAt);
                                    if (parsed && pointerIsNewer && (parsed.round !== snapshot.round || parsed.heatNumber !== snapshot.heat_number || parsed.division !== snapshot.division)) {
                                        logger.info('ConfigStore', 'Active heat pointer overrides snapshot', {
                                            snapshot: { division: snapshot.division, round: snapshot.round, heat: snapshot.heat_number },
                                            active: { division: parsed.division, round: parsed.round, heat: parsed.heatNumber }
                                        });
                                        snapshot = {
                                            ...snapshot,
                                            event_name: resolveEventDisplayName(snapshot.eventDetails?.name, snapshot.event_name),
                                            division: parsed.division,
                                            round: parsed.round,
                                            heat_number: parsed.heatNumber,
                                            updated_at: activeHeat.updated_at
                                        };
                                    }
                                }
                            } catch (err) {
                                logger.warn('ConfigStore', 'Unable to align snapshot with active_heat_pointer', err);
                            }
                        }

                        // Populate available divisions from heats (used by Admin dropdown)
                        try {
                            const categories = await fetchAllEventCategories(eventId);
                            set({ availableDivisions: categories });
                        } catch (err) {
                            logger.warn('ConfigStore', 'Unable to load divisions from heats', err);
                            set({ availableDivisions: [] });
                        }

                        if (snapshot) {
                            logger.info('ConfigStore', 'Snapshot found, building config');
                            const baseConfig = buildConfigFromSnapshot(snapshot);
                            const heatKey = ensureHeatId(
                                `${snapshot.event_name}_${snapshot.division}_R${snapshot.round}_H${snapshot.heat_number}`
                            );
                            const dbConfig = await applyHeatJudgeAssignments(baseConfig, heatKey);

                            set({
                                config: dbConfig,
                                loadedFromDb: true,
                                configSaved: true
                            });
                            // Note: Zustand persist middleware automatically saves to localStorage
                        } else {
                            logger.warn('ConfigStore', 'No snapshot found');
                            set({ loadedFromDb: false });
                        }
                    } catch (error) {
                        logger.error('ConfigStore', 'DB fetch error', error);
                        set({ loadedFromDb: false });
                    }
                })().finally(() => {
                    configLoadInFlight.delete(eventId);
                });

                configLoadInFlight.set(eventId, loadPromise);
                return loadPromise;
            },

            // persistConfig is handled by Zustand persist middleware (key: 'surf-judging-config')
            persistConfig: () => {
                // No-op: Zustand persist middleware handles localStorage automatically.
                // Legacy manual writes to 'surfJudgingConfig' have been removed.
            },

            // Save config to database for realtime sync
            saveConfigToDb: async (eventId: number, config: AppConfig) => {
                logger.info('ConfigStore', 'Saving config to database', { eventId });

                try {
                    const judges = (config.judges || []).map(id => ({
                        id,
                        name: config.judgeNames?.[id] || id,
                        identityId: config.judgeIdentities?.[id]
                    }));

                    await eventRepository.saveEventConfigSnapshot({
                        eventId,
                        eventName: config.competition,
                        division: config.division,
                        round: config.round,
                        heatNumber: config.heatId,
                        judges,
                        surfers: config.surfers || [],
                        surferNames: config.surferNames || {},
                        surferCountries: config.surferCountries || {}
                    });

                    // Update active_heat_pointer for kiosk judges
                    const { normalized: heatId } = getHeatIdentifiers(
                        config.competition,
                        config.division,
                        config.round,
                        config.heatId
                    );

                    if (supabase) {
                        try {
                            await upsertActiveHeatPointer({
                                eventId: eventId,
                                eventName: config.competition,
                                activeHeatId: heatId,
                            });
                            logger.info('ConfigStore', 'active_heat_pointer updated', { heatId });
                        } catch (pointerError) {
                            logger.warn('ConfigStore', 'active_heat_pointer update failed', pointerError);
                        }
                    }

                    await heatRepository.saveHeatConfig(heatId, {
                        event_id: eventId,
                        judges: config.judges,
                        judge_names: config.judgeNames,
                        judge_identities: config.judgeIdentities,
                        surfers: config.surfers || [],
                        waves: config.waves,
                        tournament_type: config.tournamentType
                    });

                    logger.info('ConfigStore', 'Config saved to DB successfully');
                } catch (error) {
                    logger.error('ConfigStore', 'Error saving config to database', error);
                    throw error;
                }
            },

            // Reset all config
            resetConfig: () => {
                set({
                    config: INITIAL_CONFIG,
                    configSaved: false,
                    activeEventId: null,
                    loadedFromDb: false
                });
                // Note: Zustand persist middleware automatically clears its own key
            },

            // Initialize from URL params
            initializeFromUrl: async () => {
                logger.info('ConfigStore', 'Initializing from URL');

                const urlParams = new URLSearchParams(window.location.search);
                const urlEventId = urlParams.get('eventId');
                const position = urlParams.get('position');
                const eventIdNumber = urlEventId ? Number(urlEventId) : NaN;

                // KIOSK MODE: If position=JX is in URL
                if (position && /^J[1-5]$/i.test(position)) {
                    logger.info('ConfigStore', 'Kiosk mode detected', { position });
                    set({ isKioskMode: true });
                    if (Number.isFinite(eventIdNumber)) {
                        set({ activeEventId: eventIdNumber });
                        await get().loadConfigFromDb(eventIdNumber);
                        return;
                    }
                    await get().loadKioskConfig();
                    return;
                }

                // NORMAL MODE: Load from eventId
                if (Number.isFinite(eventIdNumber)) {
                    logger.info('ConfigStore', 'Found eventId in URL', { eventIdNumber });
                    set({ activeEventId: eventIdNumber });
                    await get().loadConfigFromDb(eventIdNumber);
                    return;
                }

                // Fallback: Load from persisted activeEventId (managed by Zustand persist)
                const persistedEventId = get().activeEventId;
                if (Number.isFinite(persistedEventId) && persistedEventId && persistedEventId > 0 && !get().loadedFromDb) {
                    logger.info('ConfigStore', 'Loading config from persisted eventId', { persistedEventId });
                    set({ activeEventId: persistedEventId });
                    await get().loadConfigFromDb(persistedEventId);
                }
            },
        }),
        {
            name: 'surf-judging-config',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                config: state.config,
                configSaved: state.configSaved,
                activeEventId: state.activeEventId,
            }),
        }
    )
);
