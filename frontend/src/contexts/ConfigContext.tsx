import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { AppConfig } from '../types';
import { INITIAL_CONFIG } from '../utils/constants';
import { fetchEventConfigSnapshot, fetchHeatEntriesWithParticipants, type EventConfigSnapshot } from '../api/supabaseClient';
import { ensureHeatId } from '../utils/heat';

const STORAGE_KEYS = {
    config: 'surfJudgingConfig',
    configSaved: 'surfJudgingConfigSaved',
    activeEvent: 'surfJudgingActiveEventId'
} as const;

interface ConfigContextType {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    configSaved: boolean;
    setConfigSaved: (saved: boolean) => void;
    activeEventId: number | null;
    setActiveEventId: (id: number | null) => void;
    availableDivisions: string[];
    setAvailableDivisions: (divisions: string[]) => void;
    loadedFromDb: boolean;
    resetConfig: () => void;
    persistConfig: (config: AppConfig) => void;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
    const parseNumericId = (value: string | null) => {
        if (!value) return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
    const [configSaved, setConfigSaved] = useState(false);
    const [activeEventId, setActiveEventId] = useState<number | null>(null);
    const [availableDivisions, setAvailableDivisions] = useState<string[]>([]);
    const [loadedFromDb, setLoadedFromDb] = useState(false);

    // 1. Initial Load: Check URL and LocalStorage
    useEffect(() => {
        console.log('🔄 ConfigContext: Initializing...');

        // Check URL first
        const urlParams = new URLSearchParams(window.location.search);
        const urlEventId = urlParams.get('eventId');

        const urlEventIdNumber = parseNumericId(urlEventId);
        if (urlEventIdNumber) {
            console.log('🔗 ConfigContext: Found eventId in URL:', urlEventIdNumber);
            setActiveEventId(urlEventIdNumber);
            localStorage.setItem(STORAGE_KEYS.activeEvent, String(urlEventIdNumber));
            return;
        }

        // Check Storage
        const storedEventId = localStorage.getItem(STORAGE_KEYS.activeEvent);
        const storedEventIdNumber = parseNumericId(storedEventId);
        if (storedEventIdNumber) {
            console.log('📦 ConfigContext: Found eventId in Storage:', storedEventIdNumber);
            setActiveEventId(storedEventIdNumber);
        }

        // Load Config/Saved state
        const storedConfig = localStorage.getItem(STORAGE_KEYS.config);
        const storedSaved = localStorage.getItem(STORAGE_KEYS.configSaved);

        if (storedConfig) setConfig(JSON.parse(storedConfig));
        if (storedSaved) setConfigSaved(storedSaved === 'true');
    }, []);

    // 2. DB Fetch: Triggered when activeEventId changes
    useEffect(() => {
        if (!activeEventId) {
            setLoadedFromDb(false);
            return;
        }

        let isMounted = true;
        const fetchFromDb = async () => {
            console.log('📡 ConfigContext: Fetching snapshot for event', activeEventId);
            try {
                let snapshot = await fetchEventConfigSnapshot(activeEventId);

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
                        console.warn('⚠️ ConfigContext: Unable to enrich surfer names from heat entries', err);
                    }
                }

                if (isMounted && snapshot) {
                    console.log('✅ ConfigContext: Snapshot found');
                    const dbConfig = buildConfigFromSnapshot(snapshot);
                    setConfig(dbConfig);
                    setLoadedFromDb(true);
                    handleSetConfigSaved(true);
                    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(dbConfig));
                } else if (isMounted) {
                    console.warn('⚠️ ConfigContext: No snapshot found');
                    setLoadedFromDb(false);
                }
            } catch (error) {
                console.error('❌ ConfigContext: DB Fetch Error:', error);
                if (isMounted) setLoadedFromDb(false);
            }
        };

        fetchFromDb();
        return () => { isMounted = false; };
    }, [activeEventId]);

    // Helper function to convert database snapshot to AppConfig
    const buildConfigFromSnapshot = (snapshot: EventConfigSnapshot): AppConfig => {
        console.log('🔍 Building config from snapshot:', {
            surfers: snapshot.surfers,
            surferNames: snapshot.surferNames,
            surferCountries: snapshot.surferCountries
        });

        const config = {
            competition: snapshot.event_name || '',
            division: snapshot.division || 'OPEN',
            round: snapshot.round || 1,
            heatId: snapshot.heat_number || 1,
            judges: snapshot.judges?.map(j => j.id) || ['J1', 'J2', 'J3'],
            judgeNames: snapshot.judges?.reduce((acc, j) => ({ ...acc, [j.id]: j.name || j.id }), {}) || {},
            surfers: snapshot.surfers || ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
            surferNames: snapshot.surferNames || {},
            surferCountries: snapshot.surferCountries || {},
            surfersPerHeat: snapshot.surfers?.length || 4,
            waves: 15,
            tournamentType: 'elimination' as 'elimination' | 'repechage',
            totalSurfers: 0,
            totalHeats: 0,
            totalRounds: 1,
            eventDetails: snapshot.eventDetails
        };

        console.log('✅ Config built with surferNames:', config.surferNames);
        return config;
    };

    const persistConfig = (newConfig: AppConfig) => {
        try {
            localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(newConfig));
        } catch (error) {
            console.error('❌ Error saving config to storage:', error);
        }
    };

    const handleSetConfigSaved = (saved: boolean) => {
        setConfigSaved(saved);
        localStorage.setItem(STORAGE_KEYS.configSaved, String(saved));
    };

    const handleSetActiveEventId = (id: number | null) => {
        setActiveEventId(id);
        if (id) {
            localStorage.setItem(STORAGE_KEYS.activeEvent, String(id));
        } else {
            localStorage.removeItem(STORAGE_KEYS.activeEvent);
        }
    };

    const resetConfig = () => {
        setConfig(INITIAL_CONFIG);
        setConfigSaved(false);
        setActiveEventId(null);
        localStorage.removeItem(STORAGE_KEYS.config);
        localStorage.removeItem(STORAGE_KEYS.configSaved);
        localStorage.removeItem(STORAGE_KEYS.activeEvent);
    };

    return (
        <ConfigContext.Provider
            value={{
                config,
                setConfig,
                configSaved,
                setConfigSaved: handleSetConfigSaved,
                activeEventId,
                setActiveEventId: handleSetActiveEventId,
                availableDivisions,
                setAvailableDivisions,
                loadedFromDb,
                resetConfig,
                persistConfig
            }}
        >
            {children}
        </ConfigContext.Provider>
    );
}

export function useConfig() {
    const context = useContext(ConfigContext);
    if (context === undefined) {
        throw new Error('useConfig must be used within a ConfigProvider');
    }
    return context;
}
