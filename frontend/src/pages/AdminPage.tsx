import { useState, useCallback } from 'react';
import AdminInterface from '../components/AdminInterface';
import { useConfig } from '../contexts/ConfigContext';
import { useJudging } from '../contexts/JudgingContext';
import { useCompetitionTimer } from '../hooks/useCompetitionTimer';
import { useHeatManager } from '../hooks/useHeatManager';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useScoreManager } from '../hooks/useScoreManager';
import { useSupabaseSync } from '../hooks/useSupabaseSync';
import { getHeatIdentifiers } from '../utils/heat';
import {
    updateEventConfiguration,
    saveEventConfigSnapshot,
    fetchOrderedHeatSequence
} from '../api/supabaseClient';
import { isSupabaseConfigured } from '../lib/supabase';
import type { AppConfig } from '../types';

export default function AdminPage() {
    const {
        config,
        setConfig,
        configSaved,
        setConfigSaved,
        persistConfig,
        activeEventId,
        availableDivisions,
        loadedFromDb
    } = useConfig();

    const {
        scores,
        judgeWorkCount,
        overrideLogs
    } = useJudging();

    const {
        timer,
        startTimer,
        pauseTimer,
        resetTimer,
        setDuration
    } = useCompetitionTimer();

    const { closeHeat } = useHeatManager();
    const { publishConfigUpdate } = useRealtimeSync();
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

    const handleConfigChange = useCallback((newConfig: AppConfig) => {
        setConfig(newConfig);

        // Check if only judgeEmails changed (don't mark as unsaved for email-only changes)
        const onlyEmailsChanged =
            config.competition === newConfig.competition &&
            config.division === newConfig.division &&
            config.round === newConfig.round &&
            config.heatId === newConfig.heatId &&
            config.surfers === newConfig.surfers;

        if (configSaved && !onlyEmailsChanged) {
            setConfigSaved(false);
        }

        persistConfig(newConfig);
    }, [config, configSaved, setConfig, setConfigSaved, persistConfig]);

    const handleConfigSaved = useCallback(async (saved: boolean) => {
        setConfigSaved(saved);

        if (saved) {
            const divisionsPayload = Array.from(
                new Set<string>(
                    [...availableDivisions, config.division]
                        .filter((value): value is string => Boolean(value))
                )
            );
            const judgesPayload = config.judges.map((id) => ({
                id,
                name: config.judgeNames[id] || id,
            }));

            if (navigator.onLine && isSupabaseConfigured() && activeEventId) {
                try {
                    await updateEventConfiguration(activeEventId, {
                        config,
                        divisions: divisionsPayload,
                        judges: judgesPayload,
                    });
                    await saveEventConfigSnapshot({
                        eventId: activeEventId,
                        eventName: config.competition,
                        division: config.division,
                        round: config.round,
                        heatNumber: config.heatId,
                        judges: judgesPayload,
                    });
                    setLoadState('loaded');
                    setLoadError(null);
                } catch (error) {
                    console.warn('Impossible de synchroniser la configuration événement avec Supabase', error);
                    setLoadError(error instanceof Error ? error.message : 'Synchronisation de la configuration impossible.');
                }
            } else {
                setLoadState('loaded');
                if (!navigator.onLine) {
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
                        name: surfer,
                        country: 'SENEGAL'
                    }))
                });

                // Sauvegarder la config du heat
                await saveHeatConfig(currentHeatId, config);

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
        setConfigSaved,
        createHeat,
        saveHeatConfig,
        publishConfigUpdate,
        currentHeatId,
        persistConfig
    ]);

    const handleReloadData = () => {
        window.location.reload();
    };

    const handleResetAllData = () => {
        if (window.confirm('Êtes-vous sûr de vouloir tout réinitialiser ? Cette action est irréversible.')) {
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
        }
    };

    // Wrapper for timer change to match interface
    const handleTimerChange = (newTimer: any) => {
        // AdminInterface passes the whole timer object, but we have specific methods
        // Actually AdminInterface calls onTimerChange(newTimer)
        // We should probably expose setTimer from useCompetitionTimer if needed, 
        // or just rely on the methods.
        // AdminInterface uses onTimerChange mostly for updating duration or state manually?
        // Let's check AdminInterface usage of onTimerChange.
        // It seems it uses it to update duration.
        if (newTimer.duration !== timer.duration) {
            setDuration(newTimer.duration);
        }
    };

    // Validate heat progression before closing
    const handleCloseHeatWithValidation = useCallback(async () => {
        try {
            // Fetch the sequence to validate next heat exists  
            const heatSequence = await fetchOrderedHeatSequence(
                activeEventId || 0,
                config.division
            );

            const currentIndex = heatSequence.findIndex(h => h.heat_number === config.heatId);
            const nextHeat = heatSequence[currentIndex + 1];

            if (!nextHeat) {
                console.log('🏁 Fin de l\'événement - Aucun heat suivant trouvé');
                alert('✅ C\'était le dernier heat de cette division/round!');
                return;
            }

            console.log(`✅ Progression validée: R${config.round}H${config.heatId} → R${nextHeat.round}H${nextHeat.heat_number}`);

            // Proceed with regular closeHeat
            closeHeat();
        } catch (error) {
            console.error('❌ Erreur validation progression:', error);
            // Fallback to regular closeHeat if validation fails
            closeHeat();
        }
    }, [config, activeEventId, closeHeat]);

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
            onScoreOverride={(req) => handleScoreOverride(req, currentHeatId)}
            onRealtimeTimerStart={() => startTimer()} // AdminInterface expects (heatId, config, duration) but startTimer handles it
            onRealtimeTimerPause={() => pauseTimer()}
            onRealtimeTimerReset={() => resetTimer()}
            availableDivisions={availableDivisions}
            loadState={loadState}
            loadError={loadError}
            loadedFromDb={loadedFromDb}
            activeEventId={activeEventId ?? undefined}
        />
    );
}
