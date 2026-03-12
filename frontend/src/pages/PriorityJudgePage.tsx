import JudgeInterface from '../components/JudgeInterface';
import { PriorityJudgeLogin } from '../components/PriorityJudgeLogin';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import { getHeatIdentifiers } from '../utils/heat';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { parseActiveHeatId } from '../api/supabaseClient';
import type { AppConfig } from '../types';

export default function PriorityJudgePage() {
    const { currentJudge, login } = useAuthStore();
    const { config, configSaved, activeEventId, setActiveEventId, setConfig, loadConfigFromDb, loadKioskConfig } = useConfigStore();
    const { timer, setTimer, heatStatus, setHeatStatus } = useJudgingStore();
    const { subscribeToHeat, isConnected } = useRealtimeSync();
    const [configLoading, setConfigLoading] = useState(true);
    const prevHeatIdRef = useRef<string | null>(null);

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
    const eventIdFromUrl = searchParams.get('eventId');
    const isPriorityJudgeSession = currentJudge?.id === 'priority-judge';

    const handlePriorityConfigChange = async (nextConfig: AppConfig) => {
        setConfig(nextConfig);

        if (!isSupabaseConfigured() || !supabase || !currentHeatId) {
            return;
        }

        const { error } = await supabase
            .from('heat_realtime_config')
            .upsert({
                heat_id: currentHeatId,
                config_data: nextConfig,
                updated_by: 'priority_judge'
            }, {
                onConflict: 'heat_id'
            });

        if (error) {
            throw error;
        }
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
            loadConfigFromDb(numericId).finally(() => setConfigLoading(false));
            return;
        }

        loadKioskConfig().finally(() => setConfigLoading(false));
    }, [eventIdFromUrl, loadConfigFromDb, loadKioskConfig, setActiveEventId]);

    useEffect(() => {
        if (!isSupabaseConfigured() || !supabase || configLoading) return;

        const numericEventId = eventIdFromUrl ? parseInt(eventIdFromUrl, 10) : NaN;
        const targetEventId = !Number.isNaN(numericEventId) ? numericEventId : activeEventId;
        if (!targetEventId) return;

        const channel = supabase
            .channel(`priority-event-config-${targetEventId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'event_last_config',
                    filter: `event_id=eq.${targetEventId}`
                },
                (payload) => {
                    const row = payload.new as {
                        event_name?: string;
                        division?: string;
                        round?: number;
                        heat_number?: number;
                    } | null;
                    if (!row) return;

                    setConfig((prev) => ({
                        ...prev,
                        competition: row.event_name || prev.competition,
                        division: row.division || prev.division,
                        round: row.round ?? prev.round,
                        heatId: row.heat_number ?? prev.heatId
                    }));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [eventIdFromUrl, activeEventId, configLoading, setConfig]);

    useEffect(() => {
        if (!configSaved || !config.competition || configLoading) {
            return () => { };
        }

        const unsubscribe = subscribeToHeat(currentHeatId, (nextTimer, nextConfig, status) => {
            setTimer(nextTimer);
            if (nextConfig) {
                setConfig((prev) => ({
                    ...prev,
                    ...nextConfig
                }));
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
        if (!isSupabaseConfigured() || !supabase || configLoading) return;

        const normalizeEventKey = (value?: string) =>
            (value || '')
                .trim()
                .toLowerCase()
                .replace(/[_\s]+/g, ' ');

        const expectedEvent = normalizeEventKey(config.competition);
        const channel = supabase
            .channel(`priority-active-heat-${expectedEvent || 'global'}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'active_heat_pointer' },
                (payload) => {
                    const row = payload.new as { event_name?: string; active_heat_id?: string } | null;
                    if (!row?.active_heat_id) return;

                    const eventName = (row.event_name || '').trim();
                    if (expectedEvent && normalizeEventKey(eventName) !== expectedEvent) return;

                    const parsed = parseActiveHeatId(row.active_heat_id);
                    if (!parsed) return;

                    setConfig((prev) => ({
                        ...prev,
                        competition: eventName || prev.competition,
                        division: parsed.division,
                        round: parsed.round,
                        heatId: parsed.heatNumber
                    }));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [config.competition, configLoading, setConfig]);

    useEffect(() => {
        if (!configSaved || !config.competition || configLoading) {
            prevHeatIdRef.current = currentHeatId;
            return;
        }

        prevHeatIdRef.current = currentHeatId;
    }, [configSaved, config.competition, currentHeatId, configLoading]);

    if (configLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 flex items-center justify-center">
                <div className="text-white text-xl">Chargement de la configuration...</div>
            </div>
        );
    }

    if (!isPriorityJudgeSession) {
        return <PriorityJudgeLogin onSuccess={(judge) => login(judge.id, judge.name)} />;
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
            judgeId={currentJudge?.id}
            judgeName={currentJudge?.name}
            configSaved={configSaved}
            timer={timer}
            heatStatus={heatStatus}
            isConnected={isConnected}
            onPriorityConfigChange={handlePriorityConfigChange}
            canManagePriority={true}
            priorityOnly={true}
            interfaceTitle="Interface Juge Priorité"
        />
    );
}
