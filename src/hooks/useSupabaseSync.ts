import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Score, Heat } from '../types';
import type { AppConfig, HeatTimer } from '../types';

interface SyncStatus {
  isOnline: boolean;
  supabaseEnabled: boolean;
  lastSync: Date | null;
  pendingScores: number;
  syncError: string | null;
}

export function useSupabaseSync() {
  const supabaseEnabled = isSupabaseConfigured();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    supabaseEnabled,
    lastSync: null,
    pendingScores: 0,
    syncError: null
  });

  // Détecter les changements de connexion
  useEffect(() => {
    const handleOnline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: true, supabaseEnabled, syncError: null }));
      syncPendingScores();
    };

    const handleOffline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updatePendingCount = useCallback((scores: Score[]) => {
    const pending = scores.filter(score => !score.synced).length;
    setSyncStatus(prev => ({
      ...prev,
      pendingScores: pending
    }));
  }, []);

  const persistScores = useCallback((scores: Score[]) => {
    localStorage.setItem('surfJudgingScores', JSON.stringify(scores));
    updatePendingCount(scores);
  }, [updatePendingCount]);

  const markAllScoresSynced = useCallback(() => {
    const localScores = localStorage.getItem('surfJudgingScores');
    if (!localScores) {
      updatePendingCount([]);
      return;
    }

    try {
      const scores: Score[] = JSON.parse(localScores);
      const syncedScores = scores.map(score => ({ ...score, synced: true }));
      persistScores(syncedScores);
    } catch (error) {
      console.error('❌ Erreur lors du marquage local des scores synchronisés:', error);
    }
  }, [persistScores, updatePendingCount]);

  // Synchroniser les scores en attente
  const syncPendingScores = useCallback(async () => {
    if (!navigator.onLine || !supabaseEnabled) {
      markAllScoresSynced();
      return;
    }

    try {
      // Récupérer les scores non synchronisés du localStorage
      const localScores = localStorage.getItem('surfJudgingScores');
      if (!localScores) return;

      const scores: Score[] = JSON.parse(localScores);
      const pendingScores = scores.filter(score => !score.synced);

      if (pendingScores.length === 0) return;

      console.log(`🔄 Synchronisation de ${pendingScores.length} scores...`);

      // Envoyer les scores à Supabase
      const { error } = await supabase!
        .from('scores')
        .upsert(pendingScores.map(score => ({
          id: score.id,
          heat_id: score.heat_id,
          competition: score.competition,
          division: score.division,
          round: score.round,
          judge_id: score.judge_id,
          judge_name: score.judge_name,
          surfer: score.surfer,
          wave_number: score.wave_number,
          score: score.score,
          timestamp: score.timestamp,
          created_at: score.created_at || score.timestamp
        })));

      if (error) {
        throw error;
      }

      // Marquer les scores comme synchronisés
      const syncedScores = scores.map(score => ({
        ...score,
        synced: true
      }));

      persistScores(syncedScores);

      setSyncStatus(prev => ({
        ...prev,
        lastSync: new Date(),
        syncError: null
      }));

      console.log('✅ Synchronisation réussie !');

    } catch (error) {
      console.error('❌ Erreur de synchronisation:', error);
      setSyncStatus(prev => ({
        ...prev,
        syncError: error instanceof Error ? error.message : 'Erreur inconnue'
      }));
    }
  }, []);

  // Sauvegarder un score (local + sync si en ligne)
  const saveScore = useCallback(async (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp' | 'synced'>, heatId: string) => {
    const newScore: Score = {
      ...scoreData,
      id: Date.now().toString(),
      heat_id: heatId,
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
      synced: false
    };

    // Sauvegarder localement d'abord
    const existingScores: Score[] = JSON.parse(localStorage.getItem('surfJudgingScores') || '[]');
    const updatedScores = [...existingScores, newScore];
    persistScores(updatedScores);

    // Essayer de synchroniser immédiatement si en ligne
    if (navigator.onLine && supabaseEnabled) {
      try {
        const { error } = await supabase!
          .from('scores')
          .insert({
            id: newScore.id,
            heat_id: newScore.heat_id,
            competition: newScore.competition,
            division: newScore.division,
            round: newScore.round,
            judge_id: newScore.judge_id,
            judge_name: newScore.judge_name,
            surfer: newScore.surfer,
            wave_number: newScore.wave_number,
            score: newScore.score,
            timestamp: newScore.timestamp,
            created_at: newScore.created_at
          });

        if (!error) {
          // Marquer comme synchronisé
          newScore.synced = true;
          const syncedScores = updatedScores.map(s => s.id === newScore.id ? newScore : s);
          persistScores(syncedScores);
          
          setSyncStatus(prev => ({
            ...prev,
            lastSync: new Date()
          }));
        }
      } catch (error) {
        console.log('⚠️ Score sauvé localement, synchronisation différée');
      }
    } else {
      // Supabase non disponible : marquer immédiatement comme synchronisé pour éviter le mode "pending"
      newScore.synced = true;
      const syncedScores = updatedScores.map(s => s.id === newScore.id ? newScore : s);
      persistScores(syncedScores);
    }

    return newScore;
  }, [persistScores, supabaseEnabled]);

  // Créer un heat
  const createHeat = useCallback(async (heatData: Omit<Heat, 'id' | 'created_at'>) => {
    const newHeat: Heat = {
      ...heatData,
      id: `${heatData.competition}_${heatData.division}_R${heatData.round}_H${heatData.heat_number}`,
      created_at: new Date().toISOString()
    };

    if (!navigator.onLine || !isSupabaseConfigured()) {
      console.log('⚠️ Heat créé localement uniquement (hors ligne ou Supabase non configuré)');
      return newHeat;
    }

    try {
      const { error } = await supabase!
        .from('heats')
        .upsert({
          id: newHeat.id,
          competition: newHeat.competition,
          division: newHeat.division,
          round: newHeat.round,
          heat_number: newHeat.heat_number,
          status: newHeat.status,
          created_at: newHeat.created_at
        });

      if (error) throw error;
      console.log('✅ Heat créé dans Supabase:', newHeat.id);
    } catch (error) {
      console.error('❌ Erreur création heat:', error);
      console.log('⚠️ Heat créé localement, synchronisation différée');
    }

    return newHeat;
  }, []);

  // Sauvegarder la configuration du heat
  const saveHeatConfig = useCallback(async (heatId: string, config: AppConfig) => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      console.log('⚠️ Config heat non sauvée: hors ligne ou Supabase non configuré');
      return;
    }

    try {
      const { error } = await supabase!
        .from('heat_configs')
        .upsert({
          heat_id: heatId,
          judges: config.judges,
          surfers: config.surfers,
          judge_names: config.judgeNames,
          waves: config.waves,
          tournament_type: config.tournamentType
        }, {
          onConflict: 'heat_id'
        });

      if (error) throw error;
      console.log('✅ Configuration heat sauvée:', heatId);
    } catch (error) {
      console.log('⚠️ Config heat non sauvée (mode local):', error instanceof Error ? error.message : error);
    }
  }, []);

  // Sauvegarder l'état du timer
  const saveTimerState = useCallback(async (heatId: string, timer: HeatTimer) => {
    if (!navigator.onLine) {
      console.log('⚠️ Timer non sauvé: hors ligne');
      return;
    }
    
    if (!isSupabaseConfigured()) {
      console.log('⚠️ Timer non sauvé: Supabase non configuré');
      return;
    }

    try {
      const { error } = await supabase!
        .from('heat_timers')
        .upsert({
          heat_id: heatId,
          is_running: timer.isRunning,
          start_time: timer.startTime?.toISOString(),
          duration_minutes: timer.duration
        }, {
          onConflict: 'heat_id'
        });

      if (error) throw error;
      console.log('✅ Timer sauvé dans Supabase:', heatId);
    } catch (error) {
      console.log('⚠️ Timer non sauvé dans Supabase (mode local):', error instanceof Error ? error.message : error);
    }
  }, []);

  // Charger la configuration d'un heat
  const loadHeatConfig = useCallback(async (heatId: string) => {
    if (!navigator.onLine || !isSupabaseConfigured()) return null;

    try {
      const { data, error } = await supabase!
        .from('heat_configs')
        .select('*')
        .eq('heat_id', heatId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('❌ Erreur chargement config heat:', error);
      return null;
    }
  }, []);

  // Charger l'état du timer
  const loadTimerState = useCallback(async (heatId: string) => {
    if (!navigator.onLine || !isSupabaseConfigured()) return null;

    try {
      const { data, error } = await supabase!
        .from('heat_timers')
        .select('*')
        .eq('heat_id', heatId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('❌ Erreur chargement timer:', error);
      return null;
    }
  }, []);

  // Mettre à jour le statut d'un heat
  const updateHeatStatus = useCallback(async (heatId: string, status: 'open' | 'closed', closedAt?: string) => {
    if (!navigator.onLine || !isSupabaseConfigured()) return;

    try {
      const updateData: any = { status };
      if (closedAt) {
        updateData.closed_at = closedAt;
      }

      const { error } = await supabase!
        .from('heats')
        .update(updateData)
        .eq('id', heatId);

      if (error) throw error;
      console.log(`✅ Heat ${heatId} mis à jour: ${status}`);
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du heat:', error);
    }
  }, []);

  // Charger les scores depuis Supabase
  const loadScoresFromDatabase = useCallback(async (heatId: string) => {
    if (!navigator.onLine) {
      console.log('⚠️ Scores non chargés: hors ligne');
      return [];
    }
    
    if (!isSupabaseConfigured()) {
      console.log('⚠️ Scores non chargés: Supabase non configuré');
      return [];
    }

    try {
      const { data, error } = await supabase!
        .from('scores')
        .select('*')
        .eq('heat_id', heatId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.log('⚠️ Scores non chargés depuis Supabase (mode local):', error instanceof Error ? error.message : error);
      return [];
    }
  }, []);

  // Initialiser la synchronisation au démarrage
  useEffect(() => {
    if (navigator.onLine && isSupabaseConfigured()) {
      syncPendingScores();
    }

    // Compter les scores en attente
    const localScores = localStorage.getItem('surfJudgingScores');
    if (localScores) {
      const scores: Score[] = JSON.parse(localScores);
      updatePendingCount(scores);
    }
  }, [syncPendingScores, updatePendingCount]);

  return {
    syncStatus,
    saveScore,
    createHeat,
    updateHeatStatus,
    loadScoresFromDatabase,
    syncPendingScores,
    saveHeatConfig,
    saveTimerState,
    loadHeatConfig,
    loadTimerState
  };
}
