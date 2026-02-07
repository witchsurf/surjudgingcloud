import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, getSupabaseConfig } from '../lib/supabase';
import type { AppConfig, HeatTimer, KioskConfig, HeatSyncRequest } from '../types';
import { ensureHeatId } from '../utils/heat';
import { DEFAULT_TIMER_DURATION, INITIAL_CONFIG } from '../utils/constants';
import { parseActiveHeatId } from '../api/supabaseClient';

interface RealtimeHeatConfig {
  heat_id: string;
  status: 'waiting' | 'running' | 'paused' | 'finished';
  timer_start_time: string | null;
  timer_duration_minutes: number;
  config_data: AppConfig | null;
  updated_at: string;
  updated_by: string;
}

interface UseRealtimeSyncReturn {
  isConnected: boolean;
  lastUpdate: Date | null;
  error: string | null;
  publishTimerStart: (heatId: string, config: AppConfig, duration: number) => Promise<void>;
  publishTimerPause: (heatId: string) => Promise<void>;
  publishTimerReset: (heatId: string, duration: number) => Promise<void>;
  publishConfigUpdate: (heatId: string, config: AppConfig) => Promise<void>;
  markHeatFinished: (heatId: string) => Promise<void>;
  subscribeToHeat: (
    heatId: string,
    onUpdate: (timer: HeatTimer, config: AppConfig | null, status: RealtimeHeatConfig['status']) => void
  ) => () => void;
  fetchRealtimeState: (heatId: string) => Promise<RealtimeHeatConfig | null>;
  // New kiosk and heat sync functions
  initializeKiosk: (input: { eventId?: number | null; heatId: string; judgeId?: string | null }) => Promise<KioskConfig>;
  syncHeatViaWebhook: (heatId: string, updates: Partial<RealtimeHeatConfig>) => Promise<void>;
}

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

      // 1. Save to heat_timers table for persistence
      const { error: timerError } = await supabase!
        .from('heat_timers')
        .upsert({
          heat_id: normalizedHeatId,
          is_running: true,
          start_time: new Date().toISOString(),
          duration_minutes: duration
        }, {
          onConflict: 'heat_id'
        });

      if (timerError) {
        console.error('❌ Erreur sauvegarde heat_timers:', timerError);
        throw timerError;
      }

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

  const publishTimerPause = useCallback(async (heatId: string) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer pause ignoré (Supabase non configuré)');
      return;
    }

    try {
      await ensureAuthenticatedSession();

      // 1. Update heat_timers table
      const { error: timerError } = await supabase!
        .from('heat_timers')
        .update({
          is_running: false
        })
        .eq('heat_id', normalizedHeatId);

      if (timerError) {
        console.error('❌ Erreur pause heat_timers:', timerError);
        throw timerError;
      }

      // 2. Update heat_realtime_config for broadcasting
      const { error } = await supabase!
        .from('heat_realtime_config')
        .update({
          status: 'paused',
          updated_by: 'admin'
        })
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

      // 1. Update heat_timers table
      const { error: timerError } = await supabase!
        .from('heat_timers')
        .update({
          is_running: false,
          start_time: null,
          duration_minutes: duration
        })
        .eq('heat_id', normalizedHeatId);

      if (timerError) {
        console.error('❌ Erreur reset heat_timers:', timerError);
        throw timerError;
      }

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
    onUpdate: (timer: HeatTimer, config: AppConfig | null, status: RealtimeHeatConfig['status']) => void
  ) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!isSupabaseConfigured()) {
      console.warn('Supabase non configuré - pas de subscription');
      return () => { };
    }

    console.log('🔔 Subscription au heat:', normalizedHeatId);

    const subscription = supabase!
      .channel(`heat-${normalizedHeatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'heat_realtime_config',
          filter: `heat_id=eq.${normalizedHeatId}`
        },
        (payload) => {
          console.log('📡 Mise à jour temps réel reçue:', payload);

          const data = payload.new as RealtimeHeatConfig;
          if (!data) return;

          // Convertir les données en format local
          const timer: HeatTimer = {
            isRunning: data.status === 'running',
            startTime: data.timer_start_time ? new Date(data.timer_start_time) : null,
            duration: data.timer_duration_minutes || DEFAULT_TIMER_DURATION
          };

          const config = data.config_data ?? null;

          setLastUpdate(new Date());
          onUpdate(timer, config, data.status);
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
          console.log('📊 Nouveau score en temps réel:', payload);
          // Déclencher un événement pour notifier les composants
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
          console.log('📊 Score mis à jour en temps réel:', payload);
          window.dispatchEvent(new CustomEvent('newScoreRealtime', {
            detail: payload.new
          }));
        }
      )
      .subscribe((status) => {
        console.log('📡 Statut subscription:', status);
        if (status === 'SUBSCRIBED') {
          console.log('✅ Connecté au temps réel pour heat:', normalizedHeatId);
        }
      });

    // Charger l'état initial
    const loadInitialState = async () => {
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
        const { data, error } = await supabase!
          .from('heat_realtime_config')
          .select('*')
          .eq('heat_id', normalizedHeatId)
          .maybeSingle();

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

        if (data) {
          const timer: HeatTimer = {
            isRunning: data.status === 'running',
            startTime: data.timer_start_time ? new Date(data.timer_start_time) : null,
            duration: data.timer_duration_minutes || DEFAULT_TIMER_DURATION
          };

          const config = data.config_data ?? null;
          console.log('📋 État initial chargé:', { timer, config });
          onUpdate(timer, config, data.status);
        } else {
          // Aucune donnée trouvée, utiliser des valeurs par défaut
          const defaultTimer: HeatTimer = {
            isRunning: false,
            startTime: null,
            duration: DEFAULT_TIMER_DURATION
          };
          console.log('⚠️ Aucune config temps réel trouvée, utilisation des valeurs par défaut');
          onUpdate(defaultTimer, null, 'waiting');
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

    // Fonction de nettoyage
    return () => {
      console.log('🔌 Déconnexion subscription heat:', normalizedHeatId);
      subscription.unsubscribe();
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
