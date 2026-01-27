
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
    const { config, configSaved, setConfig } = useConfigStore();
    const { timer, setTimer, setHeatStatus } = useJudgingStore();
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
        if (!eventIdFromUrl || !isSupabaseConfigured()) {
            setConfigLoading(false);
            return;
        }

        const loadEventConfig = async () => {
            try {
                console.log('📥 Loading event config for eventId:', eventIdFromUrl);

                const { data, error } = await supabase!
                    .from('event_last_config')
                    .select('*')
                    .eq('event_id', eventIdFromUrl)
                    .single();

                if (error) {
                    console.error('❌ Error loading event config:', error);
                    setConfigLoading(false);
                    return;
                }

                if (data) {
                    console.log('✅ Event config loaded:', data);

                    // Build surferNames from data
                    const surferNames: Record<string, string> = {};
                    if (data.surfer_names && typeof data.surfer_names === 'object') {
                        Object.assign(surferNames, data.surfer_names);
                    }

                    setConfig((prev) => ({
                        ...prev,
                        competition: data.event_name || '',
                        division: data.division || '',
                        round: data.round || 1,
                        heatId: data.heat_number || 1,
                        surferNames: surferNames
                    }));
                    try {
                        localStorage.setItem('surfJudgingConfigSaved', 'true');
                    } catch { }
                    setConfigLoading(false);
                }
            } catch (err) {
                console.error('❌ Exception loading config:', err);
                setConfigLoading(false);
            }
        };

        loadEventConfig();
    }, [eventIdFromUrl, setConfig]);

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
            if (status) setHeatStatus(status);
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
            isChiefJudge={currentJudge?.id === 'CHIEF' || currentJudge?.name === 'CHIEF'}
            onHeatClose={handleHeatClose}
            isConnected={isConnected}
        />
    );
}
