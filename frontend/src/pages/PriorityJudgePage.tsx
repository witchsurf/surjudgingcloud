import JudgeInterface from '../components/JudgeInterface';
import { PriorityJudgeLogin } from '../components/PriorityJudgeLogin';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useAuthoritativeHeatId } from '../hooks/useAuthoritativeHeatId';
import { applyHeatScopedConfig } from '../utils/heatScopedConfigMerge';
import { useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { parseActiveHeatId } from '../utils/activeHeatId';
import { normalizeEventRealtimeKey, subscribeToActiveHeatPointer } from '../lib/sharedRealtimeSubscriptions';
import { resolveEventDisplayName } from '../utils/eventName';
import { getPodiumIdFromSearch } from '../utils/podium';
import type { AppConfig } from '../types';
import { upsertHeatRealtimeConfig } from '../api/modules/heats.api';
import { useSearchParams } from 'react-router-dom';

export default function PriorityJudgePage() {
    const { currentJudge, login, logout } = useAuthStore();
    const { config, configSaved, activeEventId, setActiveEventId, setConfig, loadConfigFromDb, loadKioskConfig } = useConfigStore();
    const { timer, setTimer, heatStatus, setHeatStatus } = useJudgingStore();
    const { subscribeToHeat, isConnected } = useRealtimeSync();
    const [configLoading, setConfigLoading] = useState(true);
    const prevHeatIdRef = useRef<string | null>(null);

    const [searchParams] = useSearchParams();
    const eventIdFromUrl = searchParams.get('eventId');
    const podiumId = getPodiumIdFromSearch('?' + searchParams.toString());
    const numericEventIdFromUrl = eventIdFromUrl ? Number(eventIdFromUrl) : NaN;
    const prioritySessionEventId = Number.isFinite(numericEventIdFromUrl)
        ? numericEventIdFromUrl
        : activeEventId ?? undefined;
    const isPriorityJudgeSession = currentJudge?.id === 'priority-judge';

    const { heatId: authoritativePriorityHeatId, error: heatIdError } = useAuthoritativeHeatId({
        eventId: prioritySessionEventId,
        division: config.division,
        round: config.round,
        heatNumber: config.heatId,
        podiumId,
    });
    const currentHeatId = authoritativePriorityHeatId;

    useEffect(() => {
        if (!currentJudge || !prioritySessionEventId) return;
        const sessionPodium = currentJudge.podiumId?.trim().toUpperCase();
        if (currentJudge.eventId !== prioritySessionEventId || sessionPodium !== podiumId) {
            logout();
        }
    }, [currentJudge, logout, podiumId, prioritySessionEventId]);
    // applyHeatScopedConfig is imported from utils/heatScopedConfigMerge.ts


    const handlePriorityConfigChange = async (nextConfig: AppConfig) => {
        setConfig(nextConfig);

        if (!isSupabaseConfigured() || !currentHeatId) {
            return;
        }

        await upsertHeatRealtimeConfig(currentHeatId, {
            setConfigData: true,
            configData: nextConfig,
            updatedBy: 'priority_judge',
        });
    };

    useEffect(() => {
        if (!isSupabaseConfigured()) {
            setConfigLoading(false);
            return;
        }

        if (eventIdFromUrl) {
            const numericId = parseInt(eventIdFromUrl, 10);
            if (Number.isNaN(numericId)) {
                setConfigLoading(false);
                return;
            }

            setActiveEventId(numericId);
            loadConfigFromDb(numericId, { podiumId }).finally(() => setConfigLoading(false));
            return;
        }

        loadKioskConfig().finally(() => setConfigLoading(false));
    }, [eventIdFromUrl, loadConfigFromDb, loadKioskConfig, setActiveEventId, podiumId]);

    useEffect(() => {
        if (!configSaved || !config.competition || configLoading || !currentHeatId) {
            return () => { };
        }

        const unsubscribe = subscribeToHeat(currentHeatId, (nextTimer, nextConfig, status) => {
            setTimer(nextTimer);
            if (nextConfig) {
                setConfig((prev) => applyHeatScopedConfig(prev, nextConfig));
            }
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
    }, [configSaved, config.competition, currentHeatId, subscribeToHeat, setTimer, setConfig, setHeatStatus, configLoading]);

    useEffect(() => {
        if (!isSupabaseConfigured() || configLoading) return;

        const expectedEvent = normalizeEventRealtimeKey(config.competition);
        const applyActiveHeatPointer = (row: { event_name?: string; active_heat_id?: string } | null) => {
            if (!row?.active_heat_id) return;

            const eventName = (row.event_name || '').trim();
            if (expectedEvent && normalizeEventRealtimeKey(eventName) !== expectedEvent) return;

            const parsed = parseActiveHeatId(row.active_heat_id);
            if (!parsed) return;

            const currentDivision = (config.division || '').trim().toUpperCase();
            const nextDivision = parsed.division.trim().toUpperCase();
            const heatChanged =
                currentDivision !== nextDivision ||
                Number(config.round) !== Number(parsed.round) ||
                Number(config.heatId) !== Number(parsed.heatNumber);

            if (!heatChanged) return;

            if (activeEventId) {
                void loadConfigFromDb(activeEventId, { podiumId });
                return;
            }

            setConfig((prev) => applyHeatScopedConfig(prev, {
                competition: resolveEventDisplayName(eventName, prev.competition),
                division: parsed.division,
                round: parsed.round,
                heatId: parsed.heatNumber
            }));
        };

        return subscribeToActiveHeatPointer(activeEventId, config.competition, (row) => {
            applyActiveHeatPointer(row);
        }, { podiumId });
    }, [activeEventId, config.competition, config.division, config.round, config.heatId, configLoading, setConfig, loadConfigFromDb, podiumId]);

    useEffect(() => {
        if (!configSaved || !config.competition || configLoading) {
            prevHeatIdRef.current = currentHeatId;
            return;
        }

        prevHeatIdRef.current = currentHeatId;
    }, [configSaved, config.competition, currentHeatId, configLoading]);

    if (configLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 flex flex-col items-center justify-center gap-6">
                <div style={{
                    width: 56,
                    height: 56,
                    border: '5px solid rgba(255,255,255,0.15)',
                    borderTop: '5px solid #6366f1',
                    borderRadius: '50%',
                    animation: 'spin 0.9s linear infinite',
                }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <p className="text-white/70 text-lg font-medium">Chargement de la configuration…</p>
                {heatIdError && (
                    <div style={{
                        maxWidth: 380,
                        background: 'rgba(239,68,68,0.15)',
                        border: '1px solid rgba(239,68,68,0.4)',
                        borderRadius: 12,
                        padding: '14px 20px',
                        textAlign: 'center',
                    }}>
                        <p style={{ color: '#fca5a5', fontWeight: 600, marginBottom: 8 }}>Erreur de connexion</p>
                        <p style={{ color: '#fca5a5', fontSize: 14, marginBottom: 14 }}>{heatIdError}</p>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                background: '#6366f1',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 8,
                                padding: '8px 20px',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            Réessayer
                        </button>
                    </div>
                )}
            </div>
        );
    }

    if (!isPriorityJudgeSession) {
        return <PriorityJudgeLogin onSuccess={(judge) => login(
            judge.id,
            judge.name,
            undefined,
            undefined,
            prioritySessionEventId,
            podiumId,
        )} />;
    }

    if (!configSaved) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center">
                    <h2 className="text-2xl font-bold text-blue-800 mb-2">En attente de configuration</h2>
                    <p className="text-blue-700">La tablette priorité sera disponible une fois la série configurée.</p>
                </div>
            </div>
        );
    }

    return (
        <JudgeInterface
            config={config}
            heatId={currentHeatId}
            judgeId={currentJudge?.id}
            judgeName={currentJudge?.name}
            configSaved={configSaved}
            timer={timer}
            heatStatus={heatStatus}
            isConnected={isConnected}
            onPriorityConfigChange={handlePriorityConfigChange}
            canManagePriority={true}
            priorityOnly={true}
            interfaceTitle={podiumId === 'A' ? 'Interface Juge Priorité' : `Interface Juge Priorité - Podium ${podiumId}`}
        />
    );
}
