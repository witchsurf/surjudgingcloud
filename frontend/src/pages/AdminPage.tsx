import React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminInterface from '../components/AdminInterface';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import { useCompetitionTimer } from '../hooks/useCompetitionTimer';
import { useHeatManager } from '../hooks/useHeatManager';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useScoreManager } from '../hooks/useScoreManager';
import { useSupabaseSync } from '../hooks/useSupabaseSync';
import { useHeatParticipants } from '../hooks/useHeatParticipants';
import { getHeatIdentifiers } from '../utils/heat';
import {
    updateEventConfiguration,
    saveEventConfigSnapshot,
    fetchOrderedHeatSequence,
    fetchEventIdByName,
    fetchHeatMetadata,
    upsertActiveHeatPointer
} from '../api/supabaseClient';
import { isSupabaseConfigured, canUseSupabaseConnection } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { AppConfig } from '../types';

const shallowArrayEqual = (left: string[] = [], right: string[] = []) =>
    left.length === right.length && left.every((value, index) => value === right[index]);

const shallowRecordEqual = (left: Record<string, string> = {}, right: Record<string, string> = {}) => {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    if (leftEntries.length !== rightEntries.length) return false;
    return leftEntries.every(([key, value]) => right[key] === value);
};

export default function AdminPage() {
    const [searchParams] = useSearchParams();
    const {
        config,
        setConfig,
        configSaved,
        setConfigSaved,
        persistConfig,
        activeEventId,
        availableDivisions,
        loadedFromDb,
        loadConfigFromDb,
        setActiveEventId
    } = useConfigStore();

    const {
        scores,
        judgeWorkCount,
        setJudgeWorkCount,
        overrideLogs,
        heatStatus
    } = useJudgingStore();

    const {
        timer,
        setTimer,
        setDuration
    } = useCompetitionTimer();

    // Restore judge work count from localStorage on mount
    React.useEffect(() => {
        try {
            const raw = localStorage.getItem('surfJudgingJudgeWorkCount');
            if (raw) {
                const parsed = JSON.parse(raw) as Record<string, number>;
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    setJudgeWorkCount(parsed);
                }
            }
        } catch {
            // ignore
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { closeHeat } = useHeatManager();
    const {
        publishConfigUpdate,
        publishTimerStart,
        publishTimerPause,
        publishTimerReset
    } = useRealtimeSync();
    const { handleScoreOverride } = useScoreManager();
    const { createHeat, saveHeatConfig } = useSupabaseSync();

    // Local UI state for loading feedback
    const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'empty' | 'error'>('loaded');
    const [loadError, setLoadError] = useState<string | null>(null);

    const currentHeatId = getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
    ).normalized;

    const eventIdFromUrl = Number(searchParams.get('eventId'));

    const resolveEventIdForCurrentHeat = useCallback(async (): Promise<number | null> => {
        if (Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0) {
            return eventIdFromUrl;
        }

        if (activeEventId) {
            return activeEventId;
        }

        try {
            const persistedEventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
            const persistedEventId = persistedEventIdRaw ? Number(persistedEventIdRaw) : NaN;
            if (Number.isFinite(persistedEventId) && persistedEventId > 0) {
                return persistedEventId;
            }
        } catch {
            // Ignore storage access failures.
        }

        if (currentHeatId) {
            const heatMetadata = await fetchHeatMetadata(currentHeatId);
            if (heatMetadata?.event_id) {
                return heatMetadata.event_id;
            }
        }

        if (config.competition) {
            return await fetchEventIdByName(config.competition);
        }

        return null;
    }, [activeEventId, config.competition, currentHeatId, eventIdFromUrl]);

    // Load participant names for current heat
    const { participants: heatParticipants } = useHeatParticipants(currentHeatId);

    useEffect(() => {
        const targetEventId = Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0
            ? eventIdFromUrl
            : activeEventId;

        if (!targetEventId) {
            return;
        }

        if (activeEventId !== targetEventId) {
            setActiveEventId(targetEventId);
        }

        if (!loadedFromDb || activeEventId !== targetEventId) {
            void loadConfigFromDb(targetEventId);
        }
    }, [eventIdFromUrl, activeEventId, loadedFromDb, loadConfigFromDb, setActiveEventId]);

    const handleConfigChange = useCallback((newConfig: AppConfig) => {
        setConfig(newConfig);

        const structurallySameConfig =
            config.competition === newConfig.competition &&
            config.division === newConfig.division &&
            config.round === newConfig.round &&
            config.heatId === newConfig.heatId &&
            shallowArrayEqual(config.surfers, newConfig.surfers) &&
            shallowArrayEqual(config.judges, newConfig.judges) &&
            shallowRecordEqual(config.surferNames, newConfig.surferNames) &&
            shallowRecordEqual(config.surferCountries, newConfig.surferCountries) &&
            shallowRecordEqual(config.judgeNames, newConfig.judgeNames) &&
            shallowRecordEqual(config.judgeIdentities, newConfig.judgeIdentities) &&
            (config.secretKey || '') === (newConfig.secretKey || '');

        if (configSaved && !structurallySameConfig) {
            setConfigSaved(false);
        }

        persistConfig(newConfig);
    }, [config, configSaved, setConfig, setConfigSaved, persistConfig]);

    // Sync heat participants into config when they load
    useEffect(() => {
        if (Object.keys(heatParticipants).length > 0) {
            const SURFER_ORDER = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'NOIR', 'VERT'];

            // Extract colors and sort them by standard priority
            const surfersList = Object.keys(heatParticipants).sort((a, b) => {
                const idxA = SURFER_ORDER.indexOf(a);
                const idxB = SURFER_ORDER.indexOf(b);
                // If both found, compare indices. If one not found, put it at end.
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            });

            setConfig(prev => ({
                ...prev,
                surferNames: heatParticipants,
                surfers: surfersList
            }));
        }
    }, [heatParticipants, setConfig]);

    const handleConfigSaved = useCallback(async (saved: boolean) => {
        setConfigSaved(saved);

        if (saved) {
            const targetEventId = await resolveEventIdForCurrentHeat();

            if (targetEventId && activeEventId !== targetEventId) {
                setActiveEventId(targetEventId);
            }

            const divisionsPayload = Array.from(
                new Set<string>(
                    [...availableDivisions, config.division]
                        .filter((value): value is string => Boolean(value))
                )
            );
            const judgesPayload = config.judges.map((id) => ({
                id,
                name: config.judgeNames[id] || id,
                identityId: config.judgeIdentities?.[id],
            }));

            if (canUseSupabaseConnection() && isSupabaseConfigured() && targetEventId) {
                try {
                    await updateEventConfiguration(targetEventId, {
                        config,
                        divisions: divisionsPayload,
                        judges: judgesPayload,
                    });
                    await saveEventConfigSnapshot({
                        eventId: targetEventId,
                        eventName: config.competition,
                        division: config.division,
                        round: config.round,
                        heatNumber: config.heatId,
                        judges: judgesPayload,
                        surfers: config.surfers || [],
                        surferNames: config.surferNames || {},
                        surferCountries: config.surferCountries || {},
                    });
                    setLoadState('loaded');
                    setLoadError(null);
                } catch (error) {
                    console.warn('Impossible de synchroniser la configuration événement avec Supabase', error);
                    setLoadError(error instanceof Error ? error.message : 'Synchronisation de la configuration impossible.');
                }
            } else {
                setLoadState('loaded');
                if (!canUseSupabaseConnection()) {
                    setLoadError('Configuration enregistrée localement (mode hors ligne).');
                } else {
                    setLoadError(null);
                }
            }

            try {
                await createHeat({
                    competition: config.competition,
                    division: config.division,
                    round: config.round,
                    heat_number: config.heatId,
                    status: 'open',
                    surfers: config.surfers.map(surfer => ({
                        color: surfer,
                        name: config.surferNames?.[surfer] || surfer, // Provide the real name if available
                        country: config.surferCountries?.[surfer] || 'SENEGAL'
                    }))
                });

                // Sauvegarder la config du heat
                await saveHeatConfig(currentHeatId, config);

                // Keep tablets/kiosks aligned when admin saves a new target heat/category.
                if (supabase) {
                    try {
                        await upsertActiveHeatPointer({
                            eventId: targetEventId,
                            eventName: config.competition,
                            activeHeatId: currentHeatId,
                        });
                    } catch (pointerError) {
                        console.warn('⚠️ Impossible de mettre à jour active_heat_pointer pendant la sauvegarde admin:', pointerError);
                    }
                }

                // Publier la config en temps réel
                await publishConfigUpdate(currentHeatId, config);

                console.log('✅ Heat créé et config publiée:', currentHeatId);
            } catch (error) {
                console.log('⚠️ Heat créé en mode local uniquement', error);
            }

            persistConfig(config);
        }
    }, [
        config,
        availableDivisions,
        activeEventId,
        setActiveEventId,
        setConfigSaved,
        createHeat,
        saveHeatConfig,
        publishConfigUpdate,
        currentHeatId,
        persistConfig,
        resolveEventIdForCurrentHeat
    ]);

    const handleReloadData = () => {
        window.location.reload();
    };

    const handleResetAllData = () => {
        if (window.confirm('Êtes-vous sûr de vouloir tout réinitialiser ? Cette action est irréversible.')) {
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = '/';
        }
    };

    // Subscribe to own heat timer updates (P2 fix: admin needs to see own timer start)
    const { subscribeToHeat } = useRealtimeSync();
    const { setTimer: setLocalTimer, setHeatStatus } = useJudgingStore();

    useEffect(() => {
        if (!configSaved || !config.competition) return;

        console.log('📡 Admin: subscribing to own heat timer:', currentHeatId);
        setHeatStatus('waiting');

        const unsubscribe = subscribeToHeat(currentHeatId, (nextTimer, _nextConfig, status) => {
            setLocalTimer(nextTimer);
            if (status) {
                setHeatStatus(status);
            } else if (nextTimer.isRunning) {
                setHeatStatus('running');
            } else if (nextTimer.startTime) {
                setHeatStatus('finished');
            } else {
                setHeatStatus('waiting');
            }
        });

        return unsubscribe;
    }, [configSaved, currentHeatId, subscribeToHeat, setLocalTimer, setHeatStatus, config.competition]);

    // Wrapper for timer change to match interface
    const handleTimerChange = (newTimer: any) => {
        setTimer(newTimer);
        if (newTimer.duration !== timer.duration) {
            setDuration(newTimer.duration);
        }
    };

    // Validate heat progression before closing
    const handleCloseHeatWithValidation = useCallback(async () => {
        try {
            const targetEventId = await resolveEventIdForCurrentHeat();
            if (!targetEventId) {
                await closeHeat();
                return;
            }

            // Validate against the same round/heat sequence semantics as the close workflow.
            const heatSequence = await fetchOrderedHeatSequence(
                targetEventId,
                config.division
            );

            const currentIndex = heatSequence.findIndex((heat) =>
                Number(heat.round) === Number(config.round)
                && Number(heat.heat_number) === Number(config.heatId)
            );
            const nextHeat = currentIndex >= 0
                ? heatSequence
                    .slice(currentIndex + 1)
                    .find((heat) => !['closed', 'finished'].includes((heat.status || '').toString().trim().toLowerCase()))
                : null;

            if (!nextHeat) {
                console.log('🏁 Fin de l\'événement - Aucun heat suivant trouvé');
                alert('✅ C\'était le dernier heat de cette division/round!');
                // Even on the last heat, we must still close the current heat and stop the timer.
                await closeHeat();
                return;
            }

            console.log(`✅ Progression validée: R${config.round}H${config.heatId} → R${nextHeat.round}H${nextHeat.heat_number}`);

            // Proceed with regular closeHeat
            await closeHeat();
        } catch (error) {
            console.error('❌ Erreur validation progression:', error);
            // Fallback to regular closeHeat if validation fails
            await closeHeat();
        }
    }, [config, closeHeat, resolveEventIdForCurrentHeat]);

    const handleReconnectToDb = useCallback(async () => {
        if (!isSupabaseConfigured()) {
            throw new Error('Supabase n’est pas configuré. Vérifiez les variables VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY.');
        }

        const targetEventId = await resolveEventIdForCurrentHeat();

        if (!targetEventId) {
            throw new Error('Événement introuvable en base. Ouvrez "Mes événements" puis cliquez "Continuer".');
        }

        setActiveEventId(targetEventId);
        await loadConfigFromDb(targetEventId);
    }, [loadConfigFromDb, resolveEventIdForCurrentHeat, setActiveEventId]);

    return (
        <AdminInterface
            config={config}
            onConfigChange={handleConfigChange}
            onConfigSaved={handleConfigSaved}
            configSaved={configSaved}
            timer={timer}
            onTimerChange={handleTimerChange}
            onReloadData={handleReloadData}
            onResetAllData={handleResetAllData}
            onCloseHeat={handleCloseHeatWithValidation}
            judgeWorkCount={judgeWorkCount}
            scores={scores}
            overrideLogs={overrideLogs}
            heatStatus={heatStatus}
            onScoreOverride={(req) => handleScoreOverride(req, currentHeatId)}
            onRealtimeTimerStart={publishTimerStart}
            onRealtimeTimerPause={publishTimerPause}
            onRealtimeTimerReset={publishTimerReset}
            availableDivisions={availableDivisions}
            loadState={loadState}
            loadError={loadError}
            loadedFromDb={loadedFromDb}
            activeEventId={activeEventId ?? undefined}
            onReconnectToDb={handleReconnectToDb}
        />
    );
}
