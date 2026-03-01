
import JudgeInterface from '../components/JudgeInterface';
import { JudgeLogin } from '../components/JudgeLogin';
import { KioskJudgeLogin } from '../components/KioskJudgeLogin';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import { useScoreManager } from '../hooks/useScoreManager';
import { getHeatIdentifiers } from '../utils/heat';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export default function JudgePage() {
    const { currentJudge, login } = useAuthStore();
    const { config, configSaved, setConfig, setConfigSaved, loadConfigFromDb } = useConfigStore();
    const { timer, setTimer, heatStatus, setHeatStatus } = useJudgingStore();
    const { handleScoreSubmit } = useScoreManager();
    const { subscribeToHeat, markHeatFinished, syncHeatViaWebhook, isConnected } = useRealtimeSync();
    const [configLoading, setConfigLoading] = useState(true);
    const prevHeatIdRef = useRef<string | null>(null);
    const prevConfigSavedRef = useRef<boolean>(configSaved);

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

    const searchParams = new URLSearchParams(window.location.search);
    const judgeIdFromUrl = searchParams.get('judge_id');
    const rawPosition = searchParams.get('position');
    const positionFromUrl = rawPosition ? rawPosition.trim() : null; // Kiosk mode
    const eventIdFromUrl = searchParams.get('eventId');

    const handleHeatClose = async () => {
        if (!currentHeatId) return;
        try {
            await markHeatFinished(currentHeatId);
            await syncHeatViaWebhook(currentHeatId, { status: 'finished' });
            // Optionally reload or notify user
            alert('Série clôturée et synchronisée avec succès.');
        } catch (error) {
            console.error('Erreur lors de la clôture de la série:', error);
            alert('Erreur lors de la clôture de la série.');
        }
    };

    // Load event config from DB for anonymous users (kiosk mode)
    useEffect(() => {
        if (!isSupabaseConfigured()) {
            setConfigLoading(false);
            return;
        }

        if (eventIdFromUrl && !configSaved) {
            const numericId = parseInt(eventIdFromUrl, 10);
            if (!isNaN(numericId)) {
                console.log('📥 JudgePage: Loading full config from DB for eventId:', numericId);
                loadConfigFromDb(numericId).finally(() => setConfigLoading(false));
            } else {
                setConfigLoading(false);
            }
        } else {
            // Either already saved or no eventId to load
            setConfigLoading(false);
        }
    }, [eventIdFromUrl, configSaved, loadConfigFromDb]);

    // Subscribe to realtime timer/config for the current heat
    useEffect(() => {
        if (!configSaved || !config.competition || configLoading) {
            // Return a no-op cleanup function to prevent React error #310
            return () => { };
        }

        const unsubscribe = subscribeToHeat(currentHeatId, (nextTimer, nextConfig, status) => {
            setTimer(nextTimer);
            if (nextConfig) {
                // Determine if we need to switch heats
                const heatChanged = nextConfig.heatId && nextConfig.heatId !== config.heatId;
                const roundChanged = nextConfig.round && nextConfig.round !== config.round;
                const divisionChanged = nextConfig.division && nextConfig.division !== config.division;

                if (heatChanged || roundChanged || divisionChanged) {
                    console.log('🔄 Judge: Heat/Round changed, updating config...', {
                        from: `${config.division} R${config.round}H${config.heatId}`,
                        to: `${nextConfig.division} R${nextConfig.round}H${nextConfig.heatId}`
                    });

                    // Update config directly without reload
                    setConfig((prev) => ({
                        ...prev,
                        ...nextConfig
                    }));
                } else {
                    // Just a minor update (e.g. surfers, timer)
                    setConfig((prev) => ({
                        ...prev,
                        ...nextConfig
                    }));
                }
            }
            if (status) {
                setHeatStatus(status);
            } else {
                // Fallback: infer status from timer to avoid blocking judges on stale/missing realtime status.
                if (nextTimer.isRunning) {
                    setHeatStatus('running');
                } else if (nextTimer.startTime) {
                    setHeatStatus('finished');
                } else {
                    setHeatStatus('waiting');
                }
            }
        });
        return unsubscribe;
    }, [configSaved, config.competition, currentHeatId, config.heatId, config.round, config.division, subscribeToHeat, setTimer, setConfig, setHeatStatus, configLoading]);

    // Purge local scores when a fresh config is saved or heat changes.
    useEffect(() => {
        if (!configSaved || !config.competition || configLoading) {
            prevConfigSavedRef.current = configSaved;
            prevHeatIdRef.current = currentHeatId;
            return;
        }

        const heatChanged = prevHeatIdRef.current && currentHeatId && prevHeatIdRef.current !== currentHeatId;
        const configJustSaved = !prevConfigSavedRef.current && configSaved;

        if (heatChanged || configJustSaved) {
            try {
                localStorage.removeItem('surfJudgingScores');
            } catch (error) {
                console.warn('Impossible de purger les scores locaux:', error);
            }
        }

        prevConfigSavedRef.current = configSaved;
        prevHeatIdRef.current = currentHeatId;
    }, [configSaved, config.competition, currentHeatId, configLoading]);

    // Show loading state while config is being fetched
    if (configLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center">
                <div className="text-white text-xl">Chargement de la configuration...</div>
            </div>
        );
    }

    // Kiosk mode: show simplified login with position
    if (!currentJudge && positionFromUrl && /^J[1-5]$/i.test(positionFromUrl)) {
        return (
            <KioskJudgeLogin
                position={positionFromUrl.toUpperCase()}
                onSuccess={(judge) => login(judge.id, judge.name)}
            />
        );
    }

    if (!configSaved) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center">
                    <h2 className="text-2xl font-bold text-blue-800 mb-2">En attente de configuration</h2>
                    <p className="text-blue-700 mb-4">
                        L'interface de notation sera disponible une fois la compétition configurée.
                    </p>
                    {/* DEBUG PANEL */}
                    <div className="mt-6 p-4 bg-gray-100 rounded text-left text-xs font-mono text-gray-600 border border-gray-300 overflow-auto max-h-60">
                        <p className="font-bold mb-1">🔍 Diagnostic Kiosk:</p>
                        <p>Event ID (URL): {eventIdFromUrl || 'Non défini'}</p>
                        <p>Supabase Configuré: {isSupabaseConfigured() ? 'OUI' : 'NON'}</p>
                        <p>Config Chargée: {configLoading ? 'En cours...' : 'Terminé'}</p>
                        <p>Config Sauvée (Store): {configSaved ? 'OUI' : 'NON'}</p>
                        <p>Compétition: {config.competition || 'Vide'}</p>
                        <p>Round/Heat: R{config.round} H{config.heatId}</p>
                        <p>URL API: {import.meta.env.VITE_SUPABASE_URL}</p>
                        <p>Last fetch error: {
                            // On pourrait stocker l'erreur dans un state pour l'afficher ici
                            'Voir console'
                        }</p>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Rafraîchir
                    </button>
                </div>
            </div>
        );
    }

    // Fast path: always show the judge code screen when judge_id is present, skipping magic-link/user auth.
    // Regular judge login (legacy UUID-based)
    if (!currentJudge && judgeIdFromUrl && !positionFromUrl) {
        return <JudgeLogin judgeId={judgeIdFromUrl} onSuccess={(judge) => login(judge.id, judge.name)} />;
    }

    if (!currentJudge && !judgeIdFromUrl && !positionFromUrl) {
        return <div className="p-8 text-center text-white">Lien invalide. Veuillez utiliser le lien fourni par l'administrateur.</div>;
    }

    return (
        <JudgeInterface
            config={config}
            judgeId={currentJudge?.id}
            judgeName={currentJudge?.name}
            onScoreSubmit={(score) => handleScoreSubmit(score, currentHeatId)}
            configSaved={configSaved}
            timer={timer}
            heatStatus={heatStatus}
            isChiefJudge={currentJudge?.id === 'CHIEF' || currentJudge?.name === 'CHIEF'}
            onHeatClose={handleHeatClose}
            isConnected={isConnected}
            onScoreSync={() => handleScoreSync(currentHeatId)}
        />
    );
}
