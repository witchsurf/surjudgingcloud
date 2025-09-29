import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { AppConfig, HeatTimer } from '../types';

interface RealtimeHeatConfig {
  heat_id: string;
  status: 'waiting' | 'running' | 'paused' | 'finished';
  timer_start_time: string | null;
  timer_duration_minutes: number;
  config_data: any;
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
  subscribeToHeat: (heatId: string, onUpdate: (timer: HeatTimer, config: AppConfig) => void) => () => void;
  fetchRealtimeState: (heatId: string) => Promise<RealtimeHeatConfig | null>;
}

export function useRealtimeSync(): UseRealtimeSyncReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSupabaseConfig = () => {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
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

  const handleSupabaseError = (error: any, operation: string) => {
    console.error(`❌ Erreur ${operation}:`, error);
    if (error instanceof Error && error.message.includes('Invalid API key')) {
      setError('Clé API Supabase invalide');
      setIsConnected(true);
      console.warn('🔒 Clé API invalide - basculement en mode local');
    } else {
      setError(error instanceof Error ? error.message : 'Erreur inconnue');
    }
  };

  const publishTimerStart = useCallback(async (heatId: string, config: AppConfig, duration: number) => {
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer start ignoré (Supabase non configuré)');
      return;
    }

    try {
      const { error } = await supabase!
        .from('heat_realtime_config')
        .upsert({
          heat_id: heatId,
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
      console.log('🚀 Timer START publié en temps réel:', heatId);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication timer start';
      setError(message);
      throw err;
    }
  }, []);

  const publishTimerPause = useCallback(async (heatId: string) => {
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer pause ignoré (Supabase non configuré)');
      return;
    }

    try {
      const { error } = await supabase!
        .from('heat_realtime_config')
        .update({
          status: 'paused',
          updated_by: 'admin'
        })
        .eq('heat_id', heatId);

      if (error) throw error;
      
      setLastUpdate(new Date());
      console.log('⏸️ Timer PAUSE publié en temps réel:', heatId);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication timer pause';
      setError(message);
      throw err;
    }
  }, []);

  const publishTimerReset = useCallback(async (heatId: string, duration: number) => {
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Timer reset ignoré (Supabase non configuré)');
      return;
    }

    try {
      const { error } = await supabase!
        .from('heat_realtime_config')
        .update({
          status: 'waiting',
          timer_start_time: null,
          timer_duration_minutes: duration,
          updated_by: 'admin'
        })
        .eq('heat_id', heatId);

      if (error) throw error;
      
      setLastUpdate(new Date());
      console.log('🔄 Timer RESET publié en temps réel:', heatId);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication timer reset';
      setError(message);
      throw err;
    }
  }, []);

  const publishConfigUpdate = useCallback(async (heatId: string, config: AppConfig) => {
    if (!isSupabaseConfigured()) {
      console.warn('⏩ Publication config ignorée (Supabase non configuré)');
      return;
    }

    try {
      const { error } = await supabase!
        .from('heat_realtime_config')
        .upsert({
          heat_id: heatId,
          config_data: config,
          updated_by: 'admin'
        }, {
          onConflict: 'heat_id'
        });

      if (error) throw error;
      
      setLastUpdate(new Date());
      console.log('📋 Config mise à jour en temps réel:', heatId);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur publication config';
      setError(message);
      throw err;
    }
  }, []);

  const fetchRealtimeState = useCallback(async (heatId: string) => {
    if (!isSupabaseConfigured()) return null;

    try {
      const { data, error } = await supabase!
        .from('heat_realtime_config')
        .select('*')
        .eq('heat_id', heatId)
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
    onUpdate: (timer: HeatTimer, config: AppConfig | null) => void
  ) => {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase non configuré - pas de subscription');
      return () => {};
    }

    console.log('🔔 Subscription au heat:', heatId);

    const subscription = supabase!
      .channel(`heat-${heatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'heat_realtime_config',
          filter: `heat_id=eq.${heatId}`
        },
        (payload) => {
          console.log('📡 Mise à jour temps réel reçue:', payload);
          
          const data = payload.new as RealtimeHeatConfig;
          if (!data) return;

          // Convertir les données en format local
          const timer: HeatTimer = {
            isRunning: data.status === 'running',
            startTime: data.timer_start_time ? new Date(data.timer_start_time) : null,
            duration: data.timer_duration_minutes || 20
          };

          const config = data.config_data as AppConfig;
          
          setLastUpdate(new Date());
          onUpdate(timer, config);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scores',
          filter: `heat_id=eq.${heatId}`
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
          filter: `heat_id=eq.${heatId}`
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
          console.log('✅ Connecté au temps réel pour heat:', heatId);
        }
      });

    // Charger l'état initial
    const loadInitialState = async () => {
      if (!isSupabaseConfigured()) {
        console.log('⚠️ Temps réel non disponible - Supabase non configuré');
        const defaultTimer: HeatTimer = {
          isRunning: false,
          startTime: null,
          duration: 20
        };
        onUpdate(defaultTimer, null);
        return;
      }

      try {
        const { data, error } = await supabase!
          .from('heat_realtime_config')
          .select('*')
          .eq('heat_id', heatId)
          .maybeSingle();

        if (error) {
          console.error('Erreur chargement état initial:', error);
          // Appeler onUpdate avec des valeurs par défaut même en cas d'erreur
          const defaultTimer: HeatTimer = {
            isRunning: false,
            startTime: null,
            duration: 20
          };
          onUpdate(defaultTimer, null);
          return;
        }

        if (data) {
          const timer: HeatTimer = {
            isRunning: data.status === 'running',
            startTime: data.timer_start_time ? new Date(data.timer_start_time) : null,
            duration: data.timer_duration_minutes || 20
          };

          const config = data.config_data as AppConfig;
          console.log('📋 État initial chargé:', { timer, config });
          onUpdate(timer, config);
        } else {
          // Aucune donnée trouvée, utiliser des valeurs par défaut
          const defaultTimer: HeatTimer = {
            isRunning: false,
            startTime: null,
            duration: 20
          };
          console.log('⚠️ Aucune config temps réel trouvée, utilisation des valeurs par défaut');
          onUpdate(defaultTimer, null);
        }
      } catch (err) {
        console.log('⚠️ Chargement initial en mode local uniquement');
        // Appeler onUpdate avec des valeurs par défaut même en cas d'exception
        const defaultTimer: HeatTimer = {
          isRunning: false,
          startTime: null,
          duration: 20
        };
        onUpdate(defaultTimer, null);
      }
    };

    loadInitialState();

    // Fonction de nettoyage
    return () => {
      console.log('🔌 Déconnexion subscription heat:', heatId);
      subscription.unsubscribe();
    };
  }, []);

  return {
    isConnected,
    lastUpdate,
    error,
    publishTimerStart,
    publishTimerPause,
    publishTimerReset,
    publishConfigUpdate,
    subscribeToHeat,
    fetchRealtimeState
  };
}
