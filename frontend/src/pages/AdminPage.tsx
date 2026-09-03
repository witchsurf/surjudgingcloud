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
import { resolveEventIdForHeat } from '../utils/heatWorkflow';
import { fetchHeatMetadata, fetchOrderedHeatSequence, fetchHeatBySchedule } from '../api/modules/heats.api';
import { normalizePodiumId } from '../utils/podium';
import { isSupabaseConfigured } from '../lib/supabase';
import { normalizeEventRealtimeKey, subscribeToActiveHeatPointer } from '../lib/sharedRealtimeSubscriptions';
import { parseActiveHeatId } from '../utils/activeHeatId';
import type { AppConfig } from '../types';
import { getSafeLocalStorage } from '../utils/secureStorage';

const shallowArrayEqual = (left: string[] = [], right: string[] = []) =>
    left.length === right.length && left.every((value, index) => value === right[index]);

const JERSEY_COLOR_ALIASES: Record<string, string> = {
    RED: 'ROUGE',
    WHITE: 'BLANC',
    YELLOW: 'JAUNE',
    BLUE: 'BLEU',
    GREEN: 'VERT',
    BLACK: 'NOIR',
};

const normalizeJerseyColor = (color: string) => {
    const raw = (color || '').toUpperCase().trim();
    return JERSEY_COLOR_ALIASES[raw] || raw;
};

const shallowJerseyArrayEqual = (left: string[] = [], right: string[] = []) => {
    if (left.length !== right.length) return false;
    return left.every((value, index) => normalizeJerseyColor(value) === normalizeJerseyColor(right[index]));
};

const shallowRecordEqual = (
    left: Record<string, string> = {},
    right: Record<string, string> = {}
) => {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => left[key] === right[key]);
};

const shallowJerseyRecordEqual = (
    left: Record<string, string> = {},
    right: Record<string, string> = {},
) => {
    const normalizedLeft = Object.fromEntries(
        Object.entries(left).map(([key, value]) => [normalizeJerseyColor(key), value]),
    );
    const normalizedRight = Object.fromEntries(
        Object.entries(right).map(([key, value]) => [normalizeJerseyColor(key), value]),
    );
    const leftEntries = Object.entries(normalizedLeft);
    if (leftEntries.length !== Object.keys(normalizedRight).length) return false;
    return leftEntries.every(([key, value]) => normalizedRight[key] === value);
};

const asStringRecord = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => [key, String(item ?? '').trim()])
            .filter(([key, item]) => key.trim() && item),
    );
};

const getPersistedAdminPodium = () => {
    return normalizePodiumId(getSafeLocalStorage()?.getItem('surfJudgingSelectedPodiumId'));
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
        heatStatus,
    } = useJudgingStore();

    const { timer, setTimer, setDuration } = useCompetitionTimer();
    const { closeHeat } = useHeatManager();
    const {
        publishConfigUpdate,
        publishTimerStart,
        publishTimerPause,
        publishTimerReset
    } = useRealtimeSync();
    const { handleScoreOverride } = useScoreManager();
    const { saveHeatConfig, loadHeatConfig } = useSupabaseSync();

    // Restore judge work count from localStorage on mount
    React.useEffect(() => {
        try {
            const raw = getSafeLocalStorage()?.getItem('surfJudgingJudgeWorkCount');
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

    // Local UI state for loading feedback
    const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'empty' | 'error'>('loaded');
    const [loadError, setLoadError] = useState<string | null>(null);
    const initialAdminContextRef = React.useRef('');

    const [canonicalHeatId, setCanonicalHeatId] = useState<string>('');
    const hydratedManualHeatRef = React.useRef('');
    const operatorDirtyHeatRef = React.useRef('');
    const eventIdFromUrl = Number(searchParams.get('eventId'));

    useEffect(() => {
        let isMounted = true;
        const targetEventId = (Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0 ? eventIdFromUrl : null) ?? activeEventId;

        if (!targetEventId || !config.division || !config.round || !config.heatId) {
            if (isMounted) {
                setCanonicalHeatId('');
                setLoadState('empty');
            }
            return;
        }

        setCanonicalHeatId('');
        setLoadState('loading');
        setLoadError(null);
        void fetchHeatBySchedule(targetEventId, config.division, Number(config.round), Number(config.heatId))
            .then(heat => {
                if (isMounted) {
                    if (heat?.id) {
                        setCanonicalHeatId(heat.id);
                        setLoadState('loaded');
                        setLoadError(null);
                    } else {
                        setCanonicalHeatId('');
                        setLoadState('error');
                        setLoadError(`Heat planifié introuvable`);
                    }
                }
            })
            .catch(error => {
                if (isMounted) {
                    setCanonicalHeatId('');
                    setLoadState('error');
                    setLoadError(error instanceof Error ? error.message : `Heat planifié introuvable`);
                }
            });

        return () => { isMounted = false; };
    }, [activeEventId, eventIdFromUrl, config.division, config.round, config.heatId]);

    const hasCanonicalHeatContext = Boolean(
        loadedFromDb
        && configSaved
        && (config.competition || '').trim()
        && (config.division || '').trim()
        && canonicalHeatId
        && canonicalHeatId !== 'r1_h1'
    );

    const resolveEventIdForCurrentHeat = useCallback(
        async (): Promise<number | null> => resolveEventIdForHeat({
            activeEventId: (Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0 ? eventIdFromUrl : null) ?? activeEventId,
            competition: config.competition,
            heatId: canonicalHeatId,
        }),
        [activeEventId, config.competition, canonicalHeatId, eventIdFromUrl]
    );

    // A manual division/round/heat selection must load its own canonical
    // configuration. event_last_config only represents the last podium-A heat
    // and must never make another existing heat look unsaved.
    useEffect(() => {
        const targetEventId = (Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0 ? eventIdFromUrl : null) ?? activeEventId;
        if (!targetEventId || !canonicalHeatId || configSaved) return;

        // configSaved=false is also the normal editing state. Never let this
        // effect overwrite an explicit operator change on the current heat.
        if (operatorDirtyHeatRef.current === canonicalHeatId) return;

        const hydrationKey = `${targetEventId}:${canonicalHeatId}`;
        if (hydratedManualHeatRef.current === hydrationKey) return;
        // This ref is an in-flight guard, not a permanent "already hydrated"
        // latch. A later structural reconciliation can legitimately mark the
        // same archived heat unsaved again; in that case its canonical config
        // must be re-read instead of leaving Admin in a false panel-unknown
        // state.
        hydratedManualHeatRef.current = hydrationKey;

        let cancelled = false;
        void loadHeatConfig(canonicalHeatId)
            .then((storedConfig) => {
                if (cancelled) return;
                if (!storedConfig) {
                    setLoadError('Configuration canonique du heat sélectionné introuvable.');
                    return;
                }

                const stored = storedConfig as Record<string, unknown>;
                const judges = Array.isArray(stored.judges)
                    ? stored.judges.map((judge) => String(judge ?? '').trim()).filter(Boolean)
                    : [];
                const surfers = Array.isArray(stored.surfers)
                    ? stored.surfers.map((surfer) => String(surfer ?? '').trim()).filter(Boolean)
                    : [];
                const waves = Number(stored.waves);
                const tournamentType = typeof stored.tournament_type === 'string'
                    ? stored.tournament_type
                    : undefined;

                setConfig((current) => ({
                    ...current,
                    judges: judges.length > 0 ? judges : current.judges,
                    surfers: surfers.length > 0 ? surfers : current.surfers,
                    judgeNames: Object.keys(asStringRecord(stored.judge_names)).length > 0
                        ? asStringRecord(stored.judge_names)
                        : current.judgeNames,
                    judgeIdentities: Object.keys(asStringRecord(stored.judge_identities)).length > 0
                        ? asStringRecord(stored.judge_identities)
                        : current.judgeIdentities,
                    waves: Number.isFinite(waves) && waves > 0 ? waves : current.waves,
                    tournamentType: tournamentType || current.tournamentType,
                }));
                setConfigSaved(true);
                operatorDirtyHeatRef.current = '';
                setLoadError(null);
            })
            .catch((error) => {
                if (cancelled) return;
                setLoadError(error instanceof Error ? error.message : 'Impossible de lire la configuration du heat sélectionné.');
            })
            .finally(() => {
                if (hydratedManualHeatRef.current === hydrationKey) {
                    hydratedManualHeatRef.current = null;
                }
            });

        return () => { cancelled = true; };
    }, [activeEventId, canonicalHeatId, configSaved, eventIdFromUrl, loadHeatConfig, setConfig, setConfigSaved]);

    // Load participant names for current heat
    const { participants: heatParticipants } = useHeatParticipants(
        hasCanonicalHeatContext ? canonicalHeatId : ''
    );

    const [selectedPodiumId, setSelectedPodiumId] = useState<string>(getPersistedAdminPodium());

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

        const persistedPodiumId = normalizePodiumId(selectedPodiumId);
        const contextKey = `${targetEventId}:${persistedPodiumId}`;
        if (
            initialAdminContextRef.current !== contextKey
            || !loadedFromDb
            || activeEventId !== targetEventId
        ) {
            initialAdminContextRef.current = contextKey;
            void loadConfigFromDb(targetEventId, {
                force: true,
                podiumId: persistedPodiumId,
            });
        }
    }, [eventIdFromUrl, activeEventId, loadedFromDb, loadConfigFromDb, setActiveEventId, selectedPodiumId]);

    // Live auto-advance subscription: switch Admin when active_heat_pointer changes on the active podium
    useEffect(() => {
        const targetEventId = Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0
            ? eventIdFromUrl
            : activeEventId;

        if (!isSupabaseConfigured() || !targetEventId) return;

        const expectedEvent = normalizeEventRealtimeKey(config.competition);
        const podiumId = normalizePodiumId(selectedPodiumId);

        const applyActiveHeatPointer = (row: { event_name?: string; active_heat_id?: string } | null) => {
            if (!row?.active_heat_id) return;

            const eventName = (row.event_name || '').trim();
            if (expectedEvent && normalizeEventRealtimeKey(eventName) !== expectedEvent) return;

            const parsed = parseActiveHeatId(row.active_heat_id);
            if (!parsed) return;

            const currentDivision = (config.division || '').trim().toUpperCase();
            const sameHeat =
                currentDivision === parsed.division.trim().toUpperCase() &&
                Number(config.round) === Number(parsed.round) &&
                Number(config.heatId) === Number(parsed.heatNumber);

            if (!sameHeat) {
                console.log('🔄 AdminPage: Heat change detected via active_heat_pointer, reloading DB config', {
                    from: `${config.division} R${config.round}H${config.heatId}`,
                    to: `${parsed.division} R${parsed.round}H${parsed.heatNumber}`,
                    podiumId,
                });

                void loadConfigFromDb(targetEventId, {
                    force: true,
                    includeCategories: false,
                    podiumId,
                });
            }
        };

        return subscribeToActiveHeatPointer(targetEventId, config.competition, (row) => {
            applyActiveHeatPointer(row);
        }, { initialRefresh: false, podiumId });
    }, [activeEventId, eventIdFromUrl, config.competition, config.division, config.round, config.heatId, loadConfigFromDb, selectedPodiumId]);

    const handleConfigChange = useCallback((newConfig: AppConfig) => {
        setConfig(newConfig);

        const structurallySameConfig =
            config.competition === newConfig.competition &&
            config.division === newConfig.division &&
            config.round === newConfig.round &&
            config.heatId === newConfig.heatId &&
            shallowJerseyArrayEqual(config.surfers, newConfig.surfers) &&
            shallowArrayEqual(config.judges, newConfig.judges) &&
            shallowJerseyRecordEqual(config.surferNames, newConfig.surferNames) &&
            shallowJerseyRecordEqual(config.surferCountries, newConfig.surferCountries) &&
            shallowRecordEqual(config.judgeNames, newConfig.judgeNames) &&
            shallowRecordEqual(config.judgeIdentities, newConfig.judgeIdentities) &&
            (config.secretKey || '') === (newConfig.secretKey || '');

        if (configSaved && !structurallySameConfig) {
            operatorDirtyHeatRef.current = canonicalHeatId;
            setConfigSaved(false);
        }

        persistConfig(newConfig);
    }, [canonicalHeatId, config, configSaved, setConfig, setConfigSaved, persistConfig]);

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

            setConfig(prev => {
                const next = {
                    ...prev,
                    surferNames: heatParticipants,
                    surfers: surfersList
                };

                // A planned downstream heat is often saved before its
                // qualifiers are known. Once they are resolved from the
                // canonical heat entries, this changes the scoring panel
                // structurally; it must not remain marked as saved with an
                // empty/obsolete lineup.
                if (
                    !shallowJerseyArrayEqual(prev.surfers, next.surfers) ||
                    !shallowJerseyRecordEqual(prev.surferNames, next.surferNames)
                ) {
                    operatorDirtyHeatRef.current = canonicalHeatId;
                    setConfigSaved(false);
                }

                return next;
            });
        }
    }, [canonicalHeatId, heatParticipants, setConfig, setConfigSaved]);

    const handleConfigSaved = useCallback(async (saved: boolean, podiumIdInput?: string) => {
        const podiumId = normalizePodiumId(podiumIdInput);
        if (!saved) {
            setConfigSaved(false);
            return;
        }

        // SAVE remains pending until the complete canonical DB chain resolves.
        setConfigSaved(false);

        const targetEventId = await resolveEventIdForCurrentHeat();
        if (!targetEventId || !canonicalHeatId) {
            const error = new Error(`Événement introuvable pour le heat planifié.`);
            setLoadError(error.message);
            throw error;
        }

        if (activeEventId !== targetEventId) {
            setActiveEventId(targetEventId);
        }
        // saveHeatConfig resolves event_id from localStorage. Persist the
        // already-resolved event synchronously so the first SAVE carries the
        // same canonical context as subsequent clicks.
        try {
            localStorage.setItem('surfJudgingActiveEventId', String(targetEventId));
            localStorage.setItem('eventId', String(targetEventId));
        } catch {
            // Persistence is best effort; the canonical chain reports errors.
        }

        try {
            // Admin SAVE configures an existing planning heat. Recreating it here
            // would overwrite status, created_at and other planning metadata.
            const plannedHeat = await fetchHeatMetadata(canonicalHeatId);
            const plannedHeatMatches = Boolean(
                plannedHeat
                && Number(plannedHeat.event_id) === Number(targetEventId)
                && plannedHeat.division?.trim().toUpperCase() === config.division.trim().toUpperCase()
                && Number(plannedHeat.round) === Number(config.round)
                && Number(plannedHeat.heat_number) === Number(config.heatId)
            );

            if (!plannedHeatMatches) {
                throw new Error(`Heat planifié introuvable ou incohérent : ${canonicalHeatId}.`);
            }

            // HeatRepository owns the canonical order:
            // config RPC -> assignments -> entries -> podium A event snapshot.
            await saveHeatConfig(canonicalHeatId, { ...config, podiumId });

            setConfigSaved(true);
            operatorDirtyHeatRef.current = '';
            setLoadState('loaded');
            setLoadError(null);
            console.log('✅ Configuration canonique du heat sauvegardée:', canonicalHeatId);
        } catch (error) {
            setConfigSaved(false);
            setLoadError(error instanceof Error ? error.message : 'Persistance du heat impossible.');
            console.error('❌ Persistance heat impossible', {
                heatId: canonicalHeatId,
                podiumId,
                code: (error as { code?: string })?.code,
                message: (error as { message?: string })?.message,
            });
            throw error;
        }

        // Realtime publication is secondary and follows canonical persistence.
        try {
            await publishConfigUpdate(canonicalHeatId, config);
        } catch (error) {
            console.warn('⚠️ Publication realtime de la config échouée (persistance DB conservée)', {
                heatId: canonicalHeatId,
                podiumId,
                error,
            });
        }

        persistConfig(config);
    }, [
        config,
        activeEventId,
        setActiveEventId,
        setConfigSaved,
        saveHeatConfig,
        publishConfigUpdate,
        canonicalHeatId,
        persistConfig,
        resolveEventIdForCurrentHeat
    ]);

    const handleReloadData = () => {
        window.location.reload();
    };

    const handlePodiumSwitch = useCallback(async (podiumIdInput: string) => {
        const podiumId = normalizePodiumId(podiumIdInput);
        setSelectedPodiumId(podiumId);
        const targetEventId = await resolveEventIdForCurrentHeat();
        if (!targetEventId) {
            throw new Error('Événement introuvable pour charger le podium.');
        }

        setLoadState('loading');
        setLoadError(null);
        try {
            await loadConfigFromDb(targetEventId, {
                force: true,
                includeCategories: false,
                podiumId,
            });
            setLoadState('loaded');
        } catch (error) {
            setLoadState('error');
            const message = error instanceof Error ? error.message : `Chargement du podium ${podiumId} impossible.`;
            setLoadError(message);
            throw error;
        }
    }, [loadConfigFromDb, resolveEventIdForCurrentHeat]);

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
        // heatStatus is global Zustand state. Clear it as soon as the selected
        // heat changes, even before that heat has been saved, so a closed
        // previous heat cannot lock the new heat in the Admin UI.
        if (!canonicalHeatId) return;
        setHeatStatus('waiting');
        if (!configSaved || !config.competition) return;

        console.log('📡 Admin: subscribing to own heat timer:', canonicalHeatId);

        const unsubscribe = subscribeToHeat(canonicalHeatId, (nextTimer, _nextConfig, status) => {
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
    }, [configSaved, canonicalHeatId, subscribeToHeat, setLocalTimer, setHeatStatus, config.competition]);

    // Wrapper for timer change to match interface
    const handleTimerChange = (newTimer: any) => {
        setTimer(newTimer);
        if (newTimer.duration !== timer.duration) {
            setDuration(newTimer.duration);
        }
    };

    // Validate heat progression before closing
    const handleCloseHeatWithValidation = useCallback(async (closeOptions?: { force?: boolean; reason?: string }) => {
        try {
            const targetEventId = await resolveEventIdForCurrentHeat();
            if (!targetEventId) {
                await closeHeat(closeOptions);
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
                    .find((heat) => (heat.status || '').toString().trim().toLowerCase() !== 'closed')
                : null;

            if (!nextHeat) {
                console.log('🏁 Fin de l\'événement - Aucun heat suivant trouvé');
                alert('✅ C\'était le dernier heat de cette division/round!');
                // Even on the last heat, we must still close the current heat and stop the timer.
                await closeHeat(closeOptions);
                return;
            }

            console.log(`✅ Progression validée: R${config.round}H${config.heatId} → R${nextHeat.round}H${nextHeat.heat_number}`);

            // Proceed with regular closeHeat
            await closeHeat(closeOptions);
        } catch (error) {
            console.error('❌ Erreur validation progression:', error);
            // Fallback to regular closeHeat if validation fails
            await closeHeat(closeOptions);
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
            canonicalHeatId={canonicalHeatId}
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
            onScoreOverride={(req) => handleScoreOverride(req, canonicalHeatId)}
            onRealtimeTimerStart={publishTimerStart}
            onRealtimeTimerPause={publishTimerPause}
            onRealtimeTimerReset={publishTimerReset}
            availableDivisions={availableDivisions}
            loadState={loadState}
            loadError={loadError}
            loadedFromDb={loadedFromDb}
            activeEventId={activeEventId ?? undefined}
            onReconnectToDb={handleReconnectToDb}
            onPodiumSwitch={handlePodiumSwitch}
        />
    );
}
