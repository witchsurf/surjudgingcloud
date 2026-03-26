import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, getSupabaseConfig, isLocalSupabaseMode } from '../lib/supabase';
import type { AppConfig, HeatTimer, KioskConfig, HeatSyncRequest } from '../types';
import { ensureHeatId } from '../utils/heat';
import { DEFAULT_TIMER_DURATION, INITIAL_CONFIG } from '../utils/constants';
import { parseActiveHeatId } from '../api/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface RealtimeHeatConfig {
  heat_id: string;
  status: 'waiting' | 'running' | 'paused' | 'finished';
  timer_start_time: string | null;
  timer_duration_minutes: number;
  config_data: AppConfig | null;
  updated_at: string;
  updated_by: string;
}

type HeatLifecycleStatus = RealtimeHeatConfig['status'] | 'closed';

interface UseRealtimeSyncReturn {
  isConnected: boolean;
  lastUpdate: Date | null;
  error: string | null;
  publishTimerStart: (heatId: string, config: AppConfig, duration: number) => Promise<void>;
  publishTimerPause: (heatId: string, remainingDuration?: number) => Promise<void>;
  publishTimerReset: (heatId: string, duration: number) => Promise<void>;
  publishConfigUpdate: (heatId: string, config: AppConfig) => Promise<void>;
  markHeatFinished: (heatId: string) => Promise<void>;
  subscribeToHeat: (
    heatId: string,
    onUpdate: (timer: HeatTimer, config: AppConfig | null, status: HeatLifecycleStatus) => void
  ) => () => void;
  fetchRealtimeState: (heatId: string) => Promise<RealtimeHeatConfig | null>;
  // New kiosk and heat sync functions
  initializeKiosk: (input: { eventId?: number | null; heatId: string; judgeId?: string | null }) => Promise<KioskConfig>;
  syncHeatViaWebhook: (heatId: string, updates: Partial<RealtimeHeatConfig>) => Promise<void>;
}

type HeatUpdateListener = (
  timer: HeatTimer,
  config: AppConfig | null,
  status: HeatLifecycleStatus
) => void;

interface HeatChannelState {
  channel: RealtimeChannel | null;
  listeners: Map<string, HeatUpdateListener>;
  lastTimer: HeatTimer | null;
  lastConfig: AppConfig | null;
  lastStatus: HeatLifecycleStatus | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  reconnecting: boolean;
}

const heatChannelRegistry = new Map<string, HeatChannelState>();
let heatListenerSequence = 0;

const debugRealtimeEnabled = import.meta.env.VITE_DEBUG_REALTIME === 'true';
const LOCAL_POLL_INTERVAL_MS = 1000;

const emitHeatUpdate = (
  heatId: string,
  timer: HeatTimer,
  config: AppConfig | null,
  status: HeatLifecycleStatus
) => {
  const state = heatChannelRegistry.get(heatId);
  if (!state) return;

  state.lastTimer = timer;
  state.lastConfig = config;
  state.lastStatus = status;

  for (const listener of state.listeners.values()) {
    try {
      listener(timer, config, status);
    } catch (error) {
      console.error('❌ Listener realtime failed:', error);
    }
  }
};

const refreshHeatSnapshot = async (normalizedHeatId: string) => {
  if (!supabase || !isSupabaseConfigured()) return;

  try {
    const [{ data, error }, { data: heatRow, error: heatError }] = await Promise.all([
      supabase
        .from('heat_realtime_config')
        .select('*')
        .eq('heat_id', normalizedHeatId)
        .maybeSingle(),
      supabase
        .from('heats')
        .select('status')
        .eq('id', normalizedHeatId)
        .maybeSingle()
    ]);

    if (error) {
      console.warn('⚠️ Failed to refresh heat realtime snapshot:', normalizedHeatId, error);
      return;
    }

    if (heatError && heatError.code !== 'PGRST116') {
      console.warn('⚠️ Failed to refresh heat status snapshot:', normalizedHeatId, heatError);
    }

    const heatIsClosed = (heatRow?.status || '').toString().trim().toLowerCase() === 'closed';
    const state = heatChannelRegistry.get(normalizedHeatId);
    const fallbackTimer: HeatTimer = {
      isRunning: false,
      startTime: null,
      duration: DEFAULT_TIMER_DURATION
    };

    if (!data) {
      emitHeatUpdate(
        normalizedHeatId,
        heatIsClosed ? fallbackTimer : (state?.lastTimer ?? fallbackTimer),
        state?.lastConfig ?? null,
        heatIsClosed ? 'closed' : (state?.lastStatus ?? 'waiting')
      );
      return;
    }

    const timer: HeatTimer = {
      isRunning: !heatIsClosed && data.status === 'running',
      startTime: !heatIsClosed && data.timer_start_time ? new Date(data.timer_start_time) : null,
      duration: data.timer_duration_minutes || DEFAULT_TIMER_DURATION
    };

    emitHeatUpdate(normalizedHeatId, timer, data.config_data ?? null, heatIsClosed ? 'closed' : data.status);
  } catch (error) {
    console.warn('⚠️ Heat snapshot refresh failed after reconnect:', normalizedHeatId, error);
  }
};

const createHeatChannel = (normalizedHeatId: string) => {
  const channelName = `heat-${normalizedHeatId}`;
  const state: HeatChannelState = {
    channel: null,
    listeners: new Map(),
    lastTimer: null,
    lastConfig: null,
    lastStatus: null,
    retryTimer: null,
    reconnecting: false,
  };
  heatChannelRegistry.set(normalizedHeatId, state);

  const setupChannel = () => {
    if (!heatChannelRegistry.has(normalizedHeatId)) return;

    if (state.channel && supabase) {
      try {
        const previousChannel = state.channel;
        state.channel = null;
        previousChannel.unsubscribe();
        supabase.removeChannel(previousChannel);
      } catch (error) {
        console.warn('⚠️ Failed to recycle realtime channel', normalizedHeatId, error);
      }
    }

    const channel = supabase!
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'heat_realtime_config',
          filter: `heat_id=eq.${normalizedHeatId}`
        },
        (payload) => {
          const data = payload.new as RealtimeHeatConfig;
          if (!data) return;

          const timer: HeatTimer = {
            isRunning: data.status === 'running',
            startTime: data.timer_start_time ? new Date(data.timer_start_time) : null,
            duration: data.timer_duration_minutes || DEFAULT_TIMER_DURATION
          };

          emitHeatUpdate(normalizedHeatId, timer, data.config_data ?? null, data.status);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'heats',
          filter: `id=eq.${normalizedHeatId}`
        },
        (payload) => {
          const row = payload.new as { status?: string } | null;
          const normalizedStatus = (row?.status || '').toString().trim().toLowerCase();
          if (normalizedStatus !== 'closed') return;

          const currentState = heatChannelRegistry.get(normalizedHeatId);
          const nextTimer: HeatTimer = {
            ...(currentState?.lastTimer ?? { isRunning: false, startTime: null, duration: DEFAULT_TIMER_DURATION }),
            isRunning: false,
            startTime: null,
          };

          emitHeatUpdate(normalizedHeatId, nextTimer, currentState?.lastConfig ?? null, 'closed');
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scores',
          filter: `heat_id=eq.${normalizedHeatId}`
        },
        (payload) => {
          window.dispatchEvent(new CustomEvent('newScoreRealtime', {
            detail: payload.new
          }));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scores',
          filter: `heat_id=eq.${normalizedHeatId}`
        },
        (payload) => {
          window.dispatchEvent(new CustomEvent('newScoreRealtime', {
            detail: payload.new
          }));
        }
      );

    state.channel = channel;

    channel.subscribe((status) => {
      if (state.channel !== channel) return;

      if (debugRealtimeEnabled) {
        console.log(`📡 [${channelName}] status:`, status, 'listeners:', heatChannelRegistry.get(normalizedHeatId)?.listeners.size ?? 0);
      }
      if (status === 'SUBSCRIBED') {
        state.reconnecting = false;
        void refreshHeatSnapshot(normalizedHeatId);
        window.dispatchEvent(new CustomEvent('heatRealtimeResync', {
          detail: { heatId: normalizedHeatId }
        }));
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        if (state.reconnecting) return;
        state.reconnecting = true;
        console.warn(`⚠️ Heat stream ${channelName} dropped (${status}), scheduling reconnect...`);
        state.channel = null;
        supabase!.removeChannel(channel).catch(() => {});
        if (state.retryTimer) clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(() => {
          state.retryTimer = null;
          if (heatChannelRegistry.has(normalizedHeatId)) {
            console.log(`🔄 Reconnecting heat config stream ${channelName}...`);
            setupChannel();
          }
        }, 3000 + Math.random() * 2000);
      }
    });
  };

  setupChannel();

  return state;
};

const releaseHeatChannel = (normalizedHeatId: string) => {
  const state = heatChannelRegistry.get(normalizedHeatId);
  if (!state) return;

  if (state.listeners.size === 0) {
    try {
      if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
      }
      if (state.channel) {
        const channel = state.channel;
        state.channel = null;
        state.reconnecting = false;
        channel.unsubscribe();
        supabase?.removeChannel(channel);
      }
    } catch (error) {
      console.warn('⚠️ Failed to release realtime channel', normalizedHeatId, error);
    } finally {
      heatChannelRegistry.delete(normalizedHeatId);
    }
  }
};

export function useRealtimeSync(): UseRealtimeSyncReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSupabaseConfig = () => {
      const { supabaseUrl: url, supabaseAnonKey: key } = getSupabaseConfig();

      const configured = Boolean(url && key && url !== 'undefined' && key !== 'undefined');

      if (!configured || !isSupabaseConfigured()) {
        console.warn('🔒 Variables Supabase non configurées - mode local uniquement');
        setIsConnected(false);
        setError(null);
        return false;
      }

      if (isSupabaseConfigured()) {
        setIsConnected(true);
        setError(null);
        return true;
      }
    };

    checkSupabaseConfig();
  }, []);

  const ensureAuthenticatedSession = useCallback(async () => {
    if (!isSupabaseConfigured() || !supabase) {
      const message = 'Supabase non configuré - impossible de modifier le timer.';
      setError(message);
      throw new Error(message);
    }

    if (isLocalSupabaseMode()) {
      return null;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      const message = 'Vous devez être connecté pour modifier le timer.';
      setError(message);
      throw new Error(message);
    }

    return data.session;
  }, []);

  const publishTimerStart = useCallback(async (heatId: string, config: AppConfig, duration: number) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer start ignoré (Supabase non configuré)');
      return;
    }

    try {
      await ensureAuthenticatedSession();

      // 1. Timer persistence and broadcasting now consolidated in heat_realtime_config

      // 2. Update heat_realtime_config for broadcasting
      const { error } = await supabase!
        .from('heat_realtime_config')
        .upsert({
          heat_id: normalizedHeatId,
          status: 'running',
          timer_start_time: new Date().toISOString(),
          timer_duration_minutes: duration,
          config_data: config,
          updated_by: 'admin'
        }, {
          onConflict: 'heat_id'
        });

      if (error) throw error;

      setLastUpdate(new Date());
      console.log('🚀 Timer START publié en temps réel:', normalizedHeatId);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication timer start';
      setError(message);
      throw err;
    }
  }, [ensureAuthenticatedSession]);

  const publishTimerPause = useCallback(async (heatId: string, remainingDuration?: number) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer pause ignoré (Supabase non configuré)');
      return;
    }

    try {
      await ensureAuthenticatedSession();

      // 1. Timer state update consolidated in heat_realtime_config below

      // 2. Update heat_realtime_config for broadcasting
      const realtimePauseUpdate: {
        status: 'paused';
        updated_by: string;
        timer_duration_minutes?: number;
        timer_start_time?: string | null;
      } = {
        status: 'paused',
        updated_by: 'admin'
      };
      if (typeof remainingDuration === 'number' && Number.isFinite(remainingDuration)) {
        realtimePauseUpdate.timer_duration_minutes = Number(remainingDuration.toFixed(4));
        realtimePauseUpdate.timer_start_time = null;
      }
      const { error } = await supabase!
        .from('heat_realtime_config')
        .update(realtimePauseUpdate)
        .eq('heat_id', normalizedHeatId);

      if (error) throw error;

      setLastUpdate(new Date());
      console.log('⏸️ Timer PAUSE publié en temps réel:', normalizedHeatId);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication timer pause';
      setError(message);
      throw err;
    }
  }, [ensureAuthenticatedSession]);

  const publishTimerReset = useCallback(async (heatId: string, duration: number) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer reset ignoré (Supabase non configuré)');
      return;
    }

    try {
      await ensureAuthenticatedSession();

      // 1. Timer state update consolidated in heat_realtime_config below

      // 2. Update heat_realtime_config for broadcasting
      const { error } = await supabase!
        .from('heat_realtime_config')
        .update({
          status: 'waiting',
          timer_start_time: null,
          timer_duration_minutes: duration,
          updated_by: 'admin'
        })
        .eq('heat_id', normalizedHeatId);

      if (error) throw error;

      setLastUpdate(new Date());
      console.log('🔄 Timer RESET publié en temps réel:', normalizedHeatId);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication timer reset';
      setError(message);
      throw err;
    }
  }, [ensureAuthenticatedSession]);

  const markHeatFinished = useCallback(async (heatId: string) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Statut terminé ignoré (Supabase non configuré)');
      return;
    }

    try {
      await ensureAuthenticatedSession();
      const { error } = await supabase!
        .from('heat_realtime_config')
        .update({
          status: 'finished',
          timer_start_time: null,
          updated_by: 'admin'
        })
        .eq('heat_id', normalizedHeatId);

      if (error) throw error;

      setLastUpdate(new Date());
      console.log('🏁 Heat marqué comme terminé:', normalizedHeatId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du passage à l’état terminé';
      setError(message);
      throw err;
    }
  }, [ensureAuthenticatedSession]);

  const publishConfigUpdate = useCallback(async (heatId: string, config: AppConfig) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Publication config ignorée (Supabase non configuré)');
      return;
    }

    try {
      await ensureAuthenticatedSession();
      const { error } = await supabase!
        .from('heat_realtime_config')
        .upsert({
          heat_id: normalizedHeatId,
          config_data: config,
          updated_by: 'admin'
        }, {
          onConflict: 'heat_id'
        });

      if (error) throw error;

      setLastUpdate(new Date());
      console.log('📋 Config mise à jour en temps réel:', normalizedHeatId);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication config';
      setError(message);
      throw err;
    }
  }, [ensureAuthenticatedSession]);

  const fetchRealtimeState = useCallback(async (heatId: string) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) return null;

    try {
      const { data, error } = await supabase!
        .from('heat_realtime_config')
        .select('*')
        .eq('heat_id', normalizedHeatId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return data as RealtimeHeatConfig | null;
    } catch (err) {
      console.error('❌ Erreur fetch realtime config:', err);
      return null;
    }
  }, []);

  const subscribeToHeat = useCallback((
    heatId: string,
    onUpdate: (timer: HeatTimer, config: AppConfig | null, status: HeatLifecycleStatus) => void
  ) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('Supabase non configuré - pas de subscription');
      return () => { };
    }

    const usePollingOnly = isLocalSupabaseMode();
    let listenerId: string | null = null;
    let pollingInterval: ReturnType<typeof setInterval> | null = null;
    let lastSnapshotKey: string | null = null;
    let missingRealtimeStateLogged = false;

    if (!usePollingOnly) {
      listenerId = `listener-${++heatListenerSequence}`;
      const state = heatChannelRegistry.get(normalizedHeatId) ?? createHeatChannel(normalizedHeatId);
      state.listeners.set(listenerId, (timer, config, status) => {
        setLastUpdate(new Date());
        onUpdate(timer, config, status);
      });

      if (debugRealtimeEnabled) {
        console.log('🔔 Subscription au heat:', normalizedHeatId, 'listener:', listenerId, 'active listeners:', state.listeners.size);
      }
    } else {
      console.log('📡 Realtime WS désactivé en mode LAN, fallback polling pour', normalizedHeatId);
    }

    // Charger l'état initial
    const loadInitialState = async (options?: { skipIfUnchanged?: boolean }) => {
      if (!isSupabaseConfigured()) {
        console.log('⚠️ Temps réel non disponible - Supabase non configuré');
        const defaultTimer: HeatTimer = {
          isRunning: false,
          startTime: null,
          duration: DEFAULT_TIMER_DURATION
        };
        onUpdate(defaultTimer, null, 'waiting');
        return;
      }

      try {
        const [{ data, error }, { data: heatRow, error: heatError }] = await Promise.all([
          supabase!
            .from('heat_realtime_config')
            .select('*')
            .eq('heat_id', normalizedHeatId)
            .maybeSingle(),
          supabase!
            .from('heats')
            .select('status')
            .eq('id', normalizedHeatId)
            .maybeSingle()
        ]);

        if (error) {
          console.error('Erreur chargement état initial:', error);
          // Appeler onUpdate avec des valeurs par défaut même en cas d'erreur
          const defaultTimer: HeatTimer = {
            isRunning: false,
            startTime: null,
            duration: DEFAULT_TIMER_DURATION
          };
          onUpdate(defaultTimer, null, 'waiting');
          return;
        }

        if (heatError && heatError.code !== 'PGRST116') {
          console.error('Erreur chargement statut heat:', heatError);
        }

        const heatIsClosed = (heatRow?.status || '').toString().trim().toLowerCase() === 'closed';

        if (data) {
          const snapshotKey = JSON.stringify({
            heat_status: heatRow?.status ?? null,
            status: data.status,
            timer_start_time: data.timer_start_time,
            timer_duration_minutes: data.timer_duration_minutes,
            updated_at: data.updated_at,
            config_data: data.config_data
          });
          if (options?.skipIfUnchanged && snapshotKey === lastSnapshotKey) {
            return;
          }
          lastSnapshotKey = snapshotKey;

          const timer: HeatTimer = {
            isRunning: data.status === 'running',
            startTime: data.timer_start_time ? new Date(data.timer_start_time) : null,
            duration: data.timer_duration_minutes || DEFAULT_TIMER_DURATION
          };

          const config = data.config_data ?? null;
          console.log('📋 État initial chargé:', { timer, config });
          onUpdate(
            heatIsClosed
              ? { ...timer, isRunning: false, startTime: null }
              : timer,
            config,
            heatIsClosed ? 'closed' : data.status
          );
        } else {
          const missingKey = heatIsClosed ? '__closed__' : '__missing__';
          if (options?.skipIfUnchanged && lastSnapshotKey === missingKey) {
            return;
          }
          lastSnapshotKey = missingKey;
          // Aucune donnée trouvée, utiliser des valeurs par défaut
          const defaultTimer: HeatTimer = {
            isRunning: false,
            startTime: null,
            duration: DEFAULT_TIMER_DURATION
          };
          if (!missingRealtimeStateLogged) {
            console.log('⚠️ Aucune config temps réel trouvée, utilisation des valeurs par défaut');
            missingRealtimeStateLogged = true;
          }
          onUpdate(defaultTimer, null, heatIsClosed ? 'closed' : 'waiting');
        }
      } catch (err) {
        console.log('⚠️ Chargement initial en mode local uniquement', err instanceof Error ? err.message : err);
        // Appeler onUpdate avec des valeurs par défaut même en cas d'exception
        const defaultTimer: HeatTimer = {
          isRunning: false,
          startTime: null,
          duration: DEFAULT_TIMER_DURATION
        };
        onUpdate(defaultTimer, null, 'waiting');
      }
    };

    loadInitialState();

    if (usePollingOnly) {
      pollingInterval = setInterval(() => {
        void loadInitialState({ skipIfUnchanged: true });
      }, LOCAL_POLL_INTERVAL_MS);
    }

    // Fonction de nettoyage
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
      if (!listenerId) return;
      const currentState = heatChannelRegistry.get(normalizedHeatId);
      if (!currentState) return;
      currentState.listeners.delete(listenerId);
      if (debugRealtimeEnabled) {
        console.log('🔌 Déconnexion subscription heat:', normalizedHeatId, 'listener:', listenerId, 'remaining:', currentState.listeners.size);
      }
      releaseHeatChannel(normalizedHeatId);
    };
  }, [setLastUpdate]); // Dependencies stabilized

  const initializeKiosk = useCallback(async (input: { eventId?: number | null; heatId: string; judgeId?: string | null }): Promise<KioskConfig> => {
    const normalizedHeatId = ensureHeatId(input.heatId);
    const parsed = parseActiveHeatId(normalizedHeatId);
    const eventName = parsed?.competition ?? '';
    const division = parsed?.division ?? '';
    const round = parsed?.round ?? 1;
    const heatNumber = parsed?.heatNumber ?? 1;

    const webhookBase = import.meta.env.VITE_N8N_BASE_URL || 'https://automation.surfjudging.cloud';
    const webhookUrl = import.meta.env.VITE_KIOSK_BOOTSTRAP_URL || `${webhookBase.replace(/\/$/, '')}/webhook/api/kiosk-bootstrap`;
    const secret = import.meta.env.VITE_N8N_SECRET || '';

    try {
      console.log('🎯 Initializing kiosk via webhook:', webhookUrl, normalizedHeatId);

      const url = new URL(webhookUrl);
      url.searchParams.set('event', eventName);
      url.searchParams.set('division', division);
      url.searchParams.set('round', String(round));
      url.searchParams.set('heat', String(heatNumber));
      if (input.eventId) {
        url.searchParams.set('event_id', String(input.eventId));
      }
      if (input.judgeId) {
        url.searchParams.set('kiosk', input.judgeId);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: secret ? { 'x-n8n-secret': secret } : undefined,
      });

      if (!response.ok) {
        throw new Error(`Webhook kiosk-bootstrap HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data) {
        throw new Error('Aucune configuration retournée');
      }

      const baseConfig: AppConfig = {
        ...INITIAL_CONFIG,
        ...(data.configData || {}),
        competition: data.eventName || eventName || INITIAL_CONFIG.competition,
        division: data.division || division || INITIAL_CONFIG.division,
        round: data.round || round || INITIAL_CONFIG.round,
        heatId: data.heat || heatNumber || INITIAL_CONFIG.heatId,
        surferNames: data.surferNames || {},
        surferCountries: data.surferCountries || {},
      };

      if (!baseConfig.surfers || baseConfig.surfers.length === 0) {
        baseConfig.surfers = Object.keys(baseConfig.surferNames || {});
      }

      const timer: HeatTimer = {
        isRunning: Boolean(data.timer?.isRunning),
        startTime: data.timer?.startTime ? new Date(data.timer.startTime) : null,
        duration: data.timer?.duration || DEFAULT_TIMER_DURATION,
      };

      const status: KioskConfig['status'] = timer.isRunning
        ? 'running'
        : timer.startTime
          ? 'paused'
          : 'waiting';

      const judges = (baseConfig.judges || []).map((id) => ({
        id,
        name: baseConfig.judgeNames?.[id] || id,
      }));

      const surfers = (baseConfig.surfers || []).map((color) => ({
        id: color,
        name: baseConfig.surferNames?.[color] || color,
        color,
      }));

      console.log('✅ Kiosk initialized successfully');
      return {
        heat_id: data.heatKey || normalizedHeatId,
        event_id: data.eventId || input.eventId || 0,
        judges,
        surfers,
        timer,
        config: baseConfig,
        status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur initialisation kiosk';
      setError(message);
      console.error('❌ Kiosk initialization failed:', err);
      throw err;
    }
  }, []);

  const syncHeatViaWebhook = useCallback(async (heatId: string, updates: Partial<RealtimeHeatConfig>) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured() || !supabase) {
      console.warn('⏩ Heat sync ignoré (Supabase non configuré)');
      return;
    }

    try {
      console.log('🔄 Syncing heat via webhook:', normalizedHeatId, updates);

      const payload: HeatSyncRequest = {
        heat_id: normalizedHeatId,
        ...updates
      };

      const { error } = await supabase.functions.invoke('heat-sync', {
        body: payload
      });

      if (error) throw error;

      setLastUpdate(new Date());
      console.log('✅ Heat synced successfully via webhook');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur synchronisation heat';
      setError(message);
      console.error('❌ Heat sync failed:', err);
      throw err;
    }
  }, []);

  return {
    isConnected,
    lastUpdate,
    error,
    publishTimerStart,
    publishTimerPause,
    publishTimerReset,
    markHeatFinished,
    publishConfigUpdate,
    subscribeToHeat,
    fetchRealtimeState,
    initializeKiosk,
    syncHeatViaWebhook
  };
}
