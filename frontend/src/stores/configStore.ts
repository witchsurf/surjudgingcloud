/**
 * Config Store (Zustand)
 * 
 * Manages application configuration with localStorage persistence and database sync.
 * Replaces the old ConfigContext for better performance.
 */

import { create } from 'zustand';
import type { AppConfig } from '../types';
import { INITIAL_CONFIG } from '../utils/constants';
import { activeHeatPointerRepository, eventRepository, heatRepository, panelRepository } from '../repositories';
import { fetchAllEventCategories, fetchHeatBySchedule, fetchHeatEntriesWithParticipants, fetchHeatMetadata, fetchHeatSlotMappings } from '../api/modules/heats.api';
import { ensureHeatId, ensurePersistedHeatId } from '../utils/heat';
import { resolveEventDisplayName } from '../utils/eventName';
import { logger } from '../lib/logger';
import type { EventConfigSnapshot } from '../repositories';
import { supabase } from '../lib/supabase';
import { colorLabelMap, getColorSet, type HeatColor } from '../utils/colorUtils';
import { getPodiumIdFromSearch, normalizePodiumId, shouldPreferActivePointer } from '../utils/podium';
import { parseActiveHeatId } from '../utils/activeHeatId';
// Secure storage imports removed (no longer needed)

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
    loadConfigFromDb: (eventId: number, options?: { force?: boolean; includeCategories?: boolean; preferActivePointer?: boolean; podiumId?: string | null }) => Promise<void>;
    persistConfig: (config: AppConfig) => void;
    resetConfig: () => void;
    initializeFromUrl: () => Promise<void>;
    saveConfigToDb: (eventId: number, config: AppConfig) => Promise<void>;
}

const configLoadInFlight = new Map<string, Promise<void>>();
const configLoadSequence = new Map<string, number>();
const configLastLoadAt = new Map<string, number>();
let latestRequestedConfigLoadKey = '';
const CONFIG_LOAD_DEDUPE_MS = 12000;

const areConfigsEquivalent = (left: AppConfig, right: AppConfig): boolean => {
    if (Object.is(left, right)) return true;

    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
};

// Helper to build config from snapshot
const buildConfigFromSnapshot = (snapshot: EventConfigSnapshot): AppConfig => {
    logger.debug('ConfigStore', 'Building config from snapshot', {
        surfers: snapshot.surfers,
        surferNames: snapshot.surferNames
    });

    const inferredSurfers = Array.isArray(snapshot.surfers) && snapshot.surfers.length > 0
        ? snapshot.surfers
        : getColorSet(snapshot.heat_size || 0);
    const fallbackSurfers = inferredSurfers.length > 0 ? inferredSurfers : ['ROUGE', 'BLANC', 'JAUNE'];

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
        surfers: fallbackSurfers,
        surferNames: snapshot.surferNames || {},
        surferCountries: snapshot.surferCountries || {},
        surfersPerHeat: fallbackSurfers.length,
        waves: 15,
        tournamentType: 'elimination' as 'elimination' | 'repechage',
        totalSurfers: 0,
        totalHeats: 0,
        totalRounds: 1
    };
};

const applyHeatJudgeAssignments = async (config: AppConfig, heatId: string): Promise<AppConfig> => {
    try {
        const assignments = await panelRepository.listHeatAssignments(heatId);
        if (assignments.length === 0) {
            return config;
        }

        const sortedAssignments = [...assignments].sort((a, b) =>
            a.station.localeCompare(b.station, undefined, { numeric: true, sensitivity: 'base' })
        );

        const judgeNames = sortedAssignments.reduce<Record<string, string>>((acc, assignment) => {
            acc[assignment.station] = assignment.judgeName;
            return acc;
        }, {});
        const judgeIdentities = sortedAssignments.reduce<Record<string, string>>((acc, assignment) => {
            acc[assignment.station] = assignment.judgeId;
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

const applyPodiumJudgePanel = async (
    config: AppConfig,
    eventId: number,
    podiumId: string,
): Promise<AppConfig> => {
    try {
        const panel = await panelRepository.getPodiumPanel(eventId, podiumId);
        if (!panel || panel.assignments.length === 0) return config;

        const sortedPanel = [...panel.assignments].sort((left, right) =>
            left.station.localeCompare(right.station, undefined, { numeric: true, sensitivity: 'base' })
        );

        return {
            ...config,
            judges: sortedPanel.map((assignment) => assignment.station),
            judgeNames: Object.fromEntries(
                sortedPanel.map((assignment) => [assignment.station, assignment.judgeName])
            ),
            judgeIdentities: Object.fromEntries(
                sortedPanel.map((assignment) => [assignment.station, assignment.judgeId])
            ),
        };
    } catch (error) {
        logger.warn('ConfigStore', 'Unable to load podium judge panel, keeping heat assignments', {
            eventId,
            podiumId,
            error,
        });
        return config;
    }
};

export const useConfigStore = create<ConfigStore>()(
    (set, get) => ({
            // Initial state
            config: INITIAL_CONFIG,
            configSaved: false,
            activeEventId: null,
            availableDivisions: [],
            loadedFromDb: false,
            isKioskMode: false,

            // Basic setters
            setConfig: (config) => set((state) => {
                const nextConfig = typeof config === 'function' ? config(state.config) : config;
                if (areConfigsEquivalent(state.config, nextConfig)) {
                    return state;
                }
                return { config: nextConfig };
            }),

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
                    const podiumId = getPodiumIdFromSearch(window.location.search);
                    const currentEventId = get().activeEventId;
                    const eventIdCandidate = Number.isFinite(Number(urlEventId)) && Number(urlEventId) > 0
                        ? Number(urlEventId)
                        : null;

                    if (eventIdCandidate) {
                        if (currentEventId !== eventIdCandidate) {
                            set({
                                config: INITIAL_CONFIG,
                                configSaved: false,
                                loadedFromDb: false,
                                activeEventId: eventIdCandidate,
                            });
                        } else {
                            set({ activeEventId: eventIdCandidate });
                        }
                        await get().loadConfigFromDb(eventIdCandidate, { podiumId, force: true });
                        return;
                    }

                    const activeHeat = await activeHeatPointerRepository.get({
                        eventId: currentEventId ?? null,
                        podiumId,
                    });

                    if (activeHeat) {
                        logger.info('ConfigStore', 'Active heat pointer found', activeHeat);
                        if (activeHeat.eventId) {
                            set({ activeEventId: activeHeat.eventId });
                            await get().loadConfigFromDb(activeHeat.eventId, { podiumId });
                            return;
                        }

                        const parsed = parseActiveHeatId(activeHeat.activeHeatId);

                        if (parsed) {
                            logger.info('ConfigStore', 'Parsed heat config', parsed);

                            let eventId = activeHeat.eventId ?? null;
                            if (!eventId) {
                                const heatMetadata = await fetchHeatMetadata(activeHeat.activeHeatId);
                                eventId = heatMetadata?.event_id ?? null;
                            }
                            if (!eventId) {
                                eventId = await eventRepository.fetchEventIdByName(parsed.competition);
                            }
                            if (eventId) {
                                set({ activeEventId: eventId });
                                await get().loadConfigFromDb(eventId, { podiumId });
                                return;
                            }

                            const nextHeatId = ensurePersistedHeatId(activeHeat.activeHeatId);
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
            loadConfigFromDb: async (eventId: number, options?: { force?: boolean; includeCategories?: boolean; preferActivePointer?: boolean; podiumId?: string | null }) => {
                const force = options?.force === true;
                const includeCategories = options?.includeCategories !== false;
                const preferActivePointer = options?.preferActivePointer !== false;
                const podiumId = normalizePodiumId(options?.podiumId ?? (typeof window !== 'undefined' ? getPodiumIdFromSearch(window.location.search) : null));
                const loadKey = `${eventId}:${podiumId}`;
                latestRequestedConfigLoadKey = loadKey;
                const lastLoadAt = configLastLoadAt.get(loadKey) ?? 0;
                const state = get();
                if (
                    !force &&
                    state.loadedFromDb &&
                    state.configSaved &&
                    state.activeEventId === eventId &&
                    Date.now() - lastLoadAt < CONFIG_LOAD_DEDUPE_MS
                ) {
                    logger.debug('ConfigStore', 'Skipping recent duplicate config load', { eventId });
                    return;
                }

                const existingLoad = configLoadInFlight.get(loadKey);
                if (existingLoad && !force) {
                    logger.debug('ConfigStore', 'Reusing in-flight config load', { eventId });
                    return existingLoad;
                }

                const requestSequence = (configLoadSequence.get(loadKey) ?? 0) + 1;
                configLoadSequence.set(loadKey, requestSequence);

                const loadPromise = (async () => {
                    logger.info('ConfigStore', 'Fetching config from database', { eventId });

                    try {
                        // Use EventRepository instead of supabaseClient
                        let snapshot = await eventRepository.fetchEventConfigSnapshot(eventId);

                        // event_last_config is global legacy state owned by podium A.
                        // Resolve an explicit podium pointer before enriching the heat,
                        // otherwise podium B can inherit A's lineup after a reload.
                        if (preferActivePointer && snapshot?.event_name) {
                            try {
                                const activeHeat = await activeHeatPointerRepository.get({ eventId, eventName: snapshot.event_name, podiumId });
                                if (!activeHeat && podiumId !== 'A') {
                                    logger.warn('ConfigStore', 'No active heat assigned to requested podium', {
                                        eventId,
                                        podiumId,
                                    });
                                    if (latestRequestedConfigLoadKey === loadKey && configLoadSequence.get(loadKey) === requestSequence) {
                                        set({
                                            // Keep the event context visible on an
                                            // unassigned podium. Only the heat
                                            // lineup is reset; losing competition
                                            // makes the UI fall back to open_r1_h1.
                                            config: {
                                                ...INITIAL_CONFIG,
                                                competition: resolveEventDisplayName(
                                                    snapshot.eventDetails?.name,
                                                    snapshot.event_name,
                                                ),
                                                division: snapshot.division || INITIAL_CONFIG.division,
                                            },
                                            configSaved: false,
                                            loadedFromDb: false,
                                        });
                                    }
                                    return;
                                }

                                if (activeHeat) {
                                    const parsed = parseActiveHeatId(activeHeat.activeHeatId);
                                    const pointerWins = shouldPreferActivePointer(
                                        podiumId,
                                        snapshot.updated_at,
                                        activeHeat.updatedAt,
                                    );
                                    if (parsed && pointerWins) {
                                        logger.info('ConfigStore', 'Active heat pointer selected for podium', {
                                            podiumId,
                                            snapshot: { division: snapshot.division, round: snapshot.round, heat: snapshot.heat_number },
                                            active: { division: parsed.division, round: parsed.round, heat: parsed.heatNumber },
                                        });
                                        snapshot = {
                                            ...snapshot,
                                            event_name: resolveEventDisplayName(snapshot.eventDetails?.name, snapshot.event_name),
                                            division: parsed.division,
                                            round: parsed.round,
                                            heat_number: parsed.heatNumber,
                                            updated_at: activeHeat.updatedAt,
                                        };
                                    }
                                }
                            } catch (err) {
                                logger.warn('ConfigStore', 'Unable to resolve active_heat_pointer', err);
                                if (podiumId !== 'A') {
                                    if (latestRequestedConfigLoadKey === loadKey && configLoadSequence.get(loadKey) === requestSequence) {
                                        set({
                                            config: {
                                                ...INITIAL_CONFIG,
                                                competition: resolveEventDisplayName(
                                                    snapshot?.eventDetails?.name,
                                                    snapshot?.event_name,
                                                ),
                                                division: snapshot?.division || INITIAL_CONFIG.division,
                                            },
                                            configSaved: false,
                                            loadedFromDb: false,
                                        });
                                    }
                                    return;
                                }
                            }
                        }

                        let authoritativeHeatId: string | null = null;

                        // Fallback: enrich snapshot with lineup names if missing
                        if (snapshot) {
                            try {
                                const authoritativeHeat = await fetchHeatBySchedule(
                                    eventId,
                                    snapshot.division,
                                    snapshot.round,
                                    snapshot.heat_number
                                );
                                authoritativeHeatId = authoritativeHeat?.id ?? null;
                                const heatKey = authoritativeHeatId ?? ensureHeatId(
                                    `${snapshot.event_name}_${snapshot.division}_R${snapshot.round}_H${snapshot.heat_number}`
                                );
                                const [entries, heatMeta, slotMappings] = await Promise.all([
                                    fetchHeatEntriesWithParticipants(heatKey),
                                    fetchHeatMetadata(heatKey),
                                    fetchHeatSlotMappings(heatKey).catch(() => []),
                                ]);
                                const surferNames: Record<string, string> = {};
                                const surferCountries: Record<string, string> = {};
                                const entryColors = entries
                                    .map((entry) => String(entry.color ?? '').trim().toUpperCase())
                                    .filter(Boolean);
                                const orderedHeatColors = Array.isArray(heatMeta?.color_order)
                                    ? heatMeta.color_order
                                        .map((value) => String(value ?? '').trim().toUpperCase())
                                        .filter(Boolean)
                                    : [];
                                const inferredHeatSize = Math.max(
                                    Number(heatMeta?.heat_size ?? 0),
                                    Array.isArray(slotMappings) ? slotMappings.length : 0,
                                    entryColors.length,
                                    Array.isArray(snapshot.surfers) ? snapshot.surfers.length : 0
                                );
                                const fallbackColors = inferredHeatSize > 0
                                    ? getColorSet(inferredHeatSize).map((color) => colorLabelMap[color] ?? color)
                                    : [];
                                const normalizedSnapshotSurfers = Array.isArray(snapshot.surfers)
                                    ? snapshot.surfers.map((value) => String(value ?? '').trim()).filter(Boolean)
                                    : [];
                                const normalizedOrderedHeatColors = orderedHeatColors.map((color) => {
                                    const heatColor = color as HeatColor;
                                    return colorLabelMap[heatColor] ?? color;
                                });
                                const nextSurfers = normalizedOrderedHeatColors.length > 0
                                    ? normalizedOrderedHeatColors
                                    : fallbackColors.length > 0
                                        ? fallbackColors
                                        : normalizedSnapshotSurfers;

                                entries.forEach((entry) => {
                                    const rawColor = String(entry.color ?? '').trim().toUpperCase();
                                    const color = rawColor ? (colorLabelMap[rawColor as HeatColor] ?? rawColor) : '';
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
                                    surfers: nextSurfers.length > 0 ? nextSurfers : snapshot.surfers,
                                    surferNames: Object.keys(surferNames).length
                                        ? { ...(snapshot.surferNames || {}), ...surferNames }
                                        : snapshot.surferNames,
                                    surferCountries: Object.keys(surferCountries).length
                                        ? { ...snapshot.surferCountries, ...surferCountries }
                                        : snapshot.surferCountries,
                                };
                            } catch (err) {
                                logger.warn('ConfigStore', 'Unable to enrich surfer names from heat entries', err);
                            }
                        }

                        if (includeCategories) {
                            // Populate available divisions from heats (used by Admin dropdown)
                            try {
                                const categories = await fetchAllEventCategories(eventId);
                                set({ availableDivisions: categories });
                            } catch (err) {
                                logger.warn('ConfigStore', 'Unable to load divisions from heats', err);
                                set({ availableDivisions: [] });
                            }
                        }

                        if (snapshot) {
                            logger.info('ConfigStore', 'Snapshot found, building config');
                            const baseConfig = buildConfigFromSnapshot(snapshot);
                            const heatKey = authoritativeHeatId ?? ensureHeatId(
                                `${snapshot.event_name}_${snapshot.division}_R${snapshot.round}_H${snapshot.heat_number}`
                            );
                            const heatConfig = await applyHeatJudgeAssignments(baseConfig, heatKey);
                            const dbConfig = await applyPodiumJudgePanel(heatConfig, eventId, podiumId);

                            if (latestRequestedConfigLoadKey === loadKey && configLoadSequence.get(loadKey) === requestSequence) {
                                set({
                                    config: dbConfig,
                                    activeEventId: eventId,
                                    loadedFromDb: true,
                                    configSaved: true
                                });
                                configLastLoadAt.set(loadKey, Date.now());
                            } else {
                                logger.info('ConfigStore', 'Ignoring stale podium config response', {
                                    loadKey,
                                    latestRequestedConfigLoadKey,
                                });
                            }
                        } else {
                            logger.warn('ConfigStore', 'No snapshot found in event_last_config, loading from events table');
                            try {
                                const event = await eventRepository.fetchEvent(eventId);
                                const eventCategories = await fetchAllEventCategories(eventId).catch(() => []);
                                const defaultDivision = eventCategories[0] || 'OPEN';
                                if (event?.name) {
                                    const eventName = event.name.trim();
                                    const heatKey = ensureHeatId(`${eventName}_${defaultDivision}_R1_H1`);
                                    let initialConfig: AppConfig = {
                                        ...INITIAL_CONFIG,
                                        competition: eventName,
                                        division: defaultDivision,
                                        round: 1,
                                        heatId: 1,
                                    };
                                    initialConfig = await applyHeatJudgeAssignments(initialConfig, heatKey);
                                    initialConfig = await applyPodiumJudgePanel(initialConfig, eventId, podiumId);

                                    if (latestRequestedConfigLoadKey === loadKey && configLoadSequence.get(loadKey) === requestSequence) {
                                        set({
                                            config: initialConfig,
                                            availableDivisions: eventCategories.length > 0 ? eventCategories : [defaultDivision],
                                            loadedFromDb: true,
                                            configSaved: false,
                                            activeEventId: eventId,
                                        });
                                        configLastLoadAt.set(loadKey, Date.now());
                                    }
                                    return;
                                }
                            } catch (err) {
                                logger.error('ConfigStore', 'Error loading event fallback', err);
                            }

                            if (latestRequestedConfigLoadKey === loadKey && configLoadSequence.get(loadKey) === requestSequence) {
                                set({ loadedFromDb: false });
                            }
                        }
                    } catch (error) {
                        logger.error('ConfigStore', 'DB fetch error', error);
                        if (latestRequestedConfigLoadKey === loadKey && configLoadSequence.get(loadKey) === requestSequence) {
                            set({ loadedFromDb: false });
                        }
                    }
                })().finally(() => {
                    if (configLoadSequence.get(loadKey) === requestSequence) {
                        configLoadInFlight.delete(loadKey);
                    }
                });

                configLoadInFlight.set(loadKey, loadPromise);
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

                    let heatId = '';
                    try {
                        const plannedHeat = await fetchHeatBySchedule(
                            eventId,
                            config.division,
                            config.round,
                            config.heatId
                        );
                        if (plannedHeat?.id) {
                            heatId = plannedHeat.id;
                        } else {
                            throw new Error(`Planned heat not found in DB for ${config.division} R${config.round} H${config.heatId}`);
                        }
                    } catch (error) {
                        logger.error('ConfigStore', 'Could not resolve authoritative heat ID for save', error);
                        throw error;
                    }

                    if (supabase) {
                        try {
                            await activeHeatPointerRepository.upsert({
                                eventId: eventId,
                                eventName: config.competition,
                                podiumId: 'A',
                                activeHeatId: heatId,
                            });
                            logger.info('ConfigStore', 'active_heat_pointer updated', { heatId });
                        } catch (pointerError) {
                            logger.warn('ConfigStore', 'active_heat_pointer update failed', pointerError);
                        }
                    }

                    await heatRepository.saveConfiguration(heatId, {
                        eventId,
                        judges: config.judges,
                        judgeNames: config.judgeNames,
                        judgeIdentities: config.judgeIdentities,
                        surfers: config.surfers || [],
                        waves: config.waves,
                        tournamentType: config.tournamentType
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
            },

            // Initialize from URL params
            initializeFromUrl: async () => {
                logger.info('ConfigStore', 'Initializing from URL');

                const urlParams = new URLSearchParams(window.location.search);
                const urlEventId = urlParams.get('eventId');
                const position = urlParams.get('position');
                const eventIdNumber = urlEventId ? Number(urlEventId) : NaN;
                const currentEventId = get().activeEventId;

                // KIOSK MODE: If position=JX is in URL
                if (position && /^J[1-5]$/i.test(position)) {
                    logger.info('ConfigStore', 'Kiosk mode detected', { position });
                    set({ isKioskMode: true });
                    if (Number.isFinite(eventIdNumber) && eventIdNumber > 0) {
                        if (currentEventId !== eventIdNumber) {
                            set({
                                config: INITIAL_CONFIG,
                                configSaved: false,
                                loadedFromDb: false,
                                activeEventId: eventIdNumber,
                            });
                        } else {
                            set({ activeEventId: eventIdNumber });
                        }
                        await get().loadConfigFromDb(eventIdNumber, { force: true });
                        return;
                    }
                    await get().loadKioskConfig();
                    return;
                }

                // NORMAL MODE: Load from eventId
                if (Number.isFinite(eventIdNumber) && eventIdNumber > 0) {
                    logger.info('ConfigStore', 'Found eventId in URL', { eventIdNumber });
                    if (currentEventId !== eventIdNumber) {
                        set({
                            config: INITIAL_CONFIG,
                            configSaved: false,
                            loadedFromDb: false,
                            activeEventId: eventIdNumber,
                        });
                    } else {
                        set({ activeEventId: eventIdNumber });
                    }
                    await get().loadConfigFromDb(eventIdNumber, { force: true });
                    return;
                }

                // Fallback: If no eventId in URL, load from activeEventId if set
                if (Number.isFinite(currentEventId) && currentEventId && currentEventId > 0 && !get().loadedFromDb) {
                    logger.info('ConfigStore', 'Loading config from activeEventId', { currentEventId });
                    await get().loadConfigFromDb(currentEventId);
                }
            },
        })
);
