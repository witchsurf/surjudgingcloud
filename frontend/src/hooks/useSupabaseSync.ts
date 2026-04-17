import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, canUseSupabaseConnection, isLocalSupabaseMode, syncOffline } from '../lib/supabase';
import type { Score, Heat, ScoreOverrideLog } from '../types';
import type { AppConfig, HeatTimer } from '../types';
import { ensureHeatId, buildHeatId } from '../utils/heat';
import { heatRepository, timerRepository, scoreRepository } from '../repositories';
import { upsertHeatRealtimeConfig } from '../api/supabaseClient';
import { recordScoreOverrideSecure } from '../api/supabaseClient';

function extractHeatNumber(heatId: string): number | null {
  const match = /_h(\d+)$/i.exec(heatId.trim());
  return match ? Number(match[1]) : null;
}

const normalizeScores = (scores: Score[], idGenerator?: () => string): Score[] =>
  scores.map((score) => ({
    ...score,
    id: isValidUuid(score.id) ? score.id : (idGenerator ? idGenerator() : score.id),
    heat_id: ensureHeatId(score.heat_id),
  }));

const isValidUuid = (value: string | undefined): boolean => {
  if (!value) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
};

interface SyncStatus {
  isOnline: boolean;
  supabaseEnabled: boolean;
  lastSync: Date | null;
  pendingScores: number;
  syncError: string | null;
}

export function useSupabaseSync() {
  const supabaseEnabled = isSupabaseConfigured();
  const canReachSupabase = () => canUseSupabaseConnection();
  const OVERRIDE_LOGS_KEY = 'surfJudgingOverrideLogs';
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: canReachSupabase(),
    supabaseEnabled,
    lastSync: null,
    pendingScores: 0,
    syncError: null
  });

  const updatePendingCount = useCallback((scores: Score[]) => {
    const pending = scores.filter(score => !score.synced).length;
    setSyncStatus(prev => ({
      ...prev,
      pendingScores: pending
    }));
  }, []);

  type LocalOverrideLog = ScoreOverrideLog & { synced: boolean };

  const readLocalOverrideLogs = useCallback((): LocalOverrideLog[] => {
    try {
      const raw = localStorage.getItem(OVERRIDE_LOGS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LocalOverrideLog[];
      return parsed.map((log) => ({
        ...log,
        heat_id: ensureHeatId(log.heat_id),
      }));
    } catch (error) {
      console.error('❌ Erreur lecture override logs locaux:', error);
      return [];
    }
  }, []);

  const writeLocalOverrideLogs = useCallback((logs: LocalOverrideLog[]) => {
    try {
      const normalizedLogs = logs.map((log) => ({
        ...log,
        heat_id: ensureHeatId(log.heat_id),
      }));
      localStorage.setItem(OVERRIDE_LOGS_KEY, JSON.stringify(normalizedLogs));
    } catch (error) {
      console.error('❌ Erreur écriture override logs locaux:', error);
    }
  }, []);

  const syncOverrideLogs = useCallback(async () => {
    if (!canReachSupabase() || !supabaseEnabled) return;

    const localLogs = readLocalOverrideLogs();
    const pendingLogs = localLogs.filter(log => !log.synced);
    if (pendingLogs.length === 0) return;

    try {
      for (const log of pendingLogs) {
        await recordScoreOverrideSecure({
          id: log.id,
          heat_id: log.heat_id,
          score_id: log.score_id,
          judge_id: log.judge_id,
          judge_name: log.judge_name,
          judge_station: log.judge_station ?? log.judge_id,
          judge_identity_id: log.judge_identity_id ?? null,
          surfer: log.surfer,
          wave_number: log.wave_number,
          previous_score: log.previous_score,
          new_score: log.new_score,
          reason: log.reason,
          comment: log.comment,
          overridden_by: log.overridden_by,
          overridden_by_name: log.overridden_by_name,
          created_at: log.created_at,
        });
      }

      const merged = localLogs.map(log => ({ ...log, synced: true }));
      writeLocalOverrideLogs(merged);
    } catch (error) {
      console.error('❌ Synchronisation overrides échouée:', error);
    }
  }, [supabaseEnabled, readLocalOverrideLogs, writeLocalOverrideLogs]);

  // Synchroniser les scores en attente
  const syncPendingScores = useCallback(async () => {
    if (!canReachSupabase() || !supabaseEnabled) {
      setSyncStatus(prev => ({
        ...prev,
        isOnline: isLocalSupabaseMode() ? true : false,
        syncError: null
      }));
      return;
    }

    try {
      const result = await scoreRepository.syncPendingScores();

      const localScores = localStorage.getItem('surfJudgingScores');
      const scores: Score[] = localScores ? normalizeScores(JSON.parse(localScores), generateId) : [];
      updatePendingCount(scores);

      setSyncStatus(prev => ({
        ...prev,
        lastSync: new Date(),
        syncError: null
      }));

      console.log(`✅ Synchronisation réussie: ${result.success} score(s), ${result.heats} heat(s)`);

    } catch (error) {
      console.error('❌ Erreur de synchronisation:', error);
      setSyncStatus(prev => ({
        ...prev,
        syncError: error instanceof Error ? error.message : 'Erreur inconnue'
      }));
    }
  }, [supabaseEnabled, updatePendingCount]);

  // Détecter les changements de connexion
  useEffect(() => {
    const handleOnline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: canReachSupabase(), supabaseEnabled, syncError: null }));
      syncPendingScores();
      syncOverrideLogs();
    };

    const handleOffline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: isLocalSupabaseMode() ? true : false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [supabaseEnabled, syncPendingScores, syncOverrideLogs]);

  const generateId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    // Fallback UUID-ish (not perfect but avoids non-UUID errors server-side)
    const ts = Date.now().toString(16).padStart(12, '0');
    const rand = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
    return `00000000-0000-4000-${rand}-${ts}`;
  };

  // Créer un heat
  const createHeat = useCallback(async (heatData: Partial<Heat>) => {
    const normalizedHeatId = heatData.id || buildHeatId(
      heatData.competition || '',
      heatData.division || '',
      Number(heatData.round) || 1,
      Number(heatData.heat_number) || 1
    );

    const newHeat: Heat = {
      ...heatData,
      id: normalizedHeatId,
      created_at: new Date().toISOString()
    } as Heat;

    const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
    const eventId = eventIdRaw ? parseInt(eventIdRaw, 10) : null;

    try {
      const normalizedStatus =
        heatData.status === 'open'
          ? 'waiting'
          : heatData.status === 'closed'
            ? 'closed'
            : heatData.status;

      await heatRepository.createHeat({
        id: newHeat.id,
        event_id: eventId,
        competition: newHeat.competition,
        division: newHeat.division,
        round: newHeat.round,
        heat_number: newHeat.heat_number,
        status: normalizedStatus,
        created_at: newHeat.created_at
      });

      // We still do heat_realtime_config initialization here to ensure the row exists,
      // but TimerRepository will handle the actual timer state later.
      if (canReachSupabase() && isSupabaseConfigured()) {
        try {
          await upsertHeatRealtimeConfig(newHeat.id, {
            updatedBy: 'system',
          });
        } catch (error) {
           console.error('❌ Erreur initialisation heat_realtime_config:', error);
        }
      }
    } catch (error) {
       console.error('❌ Erreur création heat via repository:', error);
    }

    return newHeat;
  }, []);

  // Sauvegarder la configuration du heat
  const saveHeatConfig = useCallback(async (heatId: string, config: AppConfig) => {
    const normalizedHeatId = ensureHeatId(heatId);
    const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
    const eventId = eventIdRaw ? parseInt(eventIdRaw, 10) : null;

    try {
      await heatRepository.saveHeatConfig(normalizedHeatId, {
        event_id: eventId,
        judges: config.judges,
        surfers: config.surfers,
        judge_names: config.judgeNames,
        judge_identities: config.judgeIdentities,
        surfer_names: config.surferNames,
        surfer_countries: config.surferCountries,
        waves: config.waves,
        tournament_type: config.tournamentType
      });
    } catch (error) {
       console.error('❌ Erreur configuration heat via repository:', error);
    }
  }, []);

  // Sauvegarder l'état du timer
  const saveTimerState = useCallback(async (heatId: string, timer: HeatTimer) => {
    try {
      await timerRepository.saveTimerState(heatId, timer);
    } catch (error) {
      console.error('❌ EXCEPTION saveTimerState:', error);
    }
  }, []);

  // Charger la configuration d'un heat
  const loadHeatConfig = useCallback(async (heatId: string) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!canReachSupabase() || !isSupabaseConfigured()) return null;

    try {
      const { data, error } = await supabase!
        .from('heat_configs')
        .select('*')
        .eq('heat_id', normalizedHeatId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return null;

      const assignments = await heatRepository.fetchHeatJudgeAssignments(normalizedHeatId);
      if (assignments.length === 0) {
        return data;
      }

      return {
        ...data,
        judges: assignments.map((assignment) => assignment.station),
        judge_names: assignments.reduce<Record<string, string>>((acc, assignment) => {
          acc[assignment.station] = assignment.judge_name;
          return acc;
        }, {}),
        judge_identities: assignments.reduce<Record<string, string>>((acc, assignment) => {
          acc[assignment.station] = assignment.judge_id;
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('❌ Erreur chargement config heat:', error);
      return null;
    }
  }, []);

  // Charger l'état du timer
  const loadTimerState = useCallback(async (heatId: string) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!canReachSupabase() || !isSupabaseConfigured()) return null;

    try {
      const { data, error } = await supabase!
        .from('heat_realtime_config')
        .select('heat_id, status, timer_start_time, timer_duration_minutes')
        .eq('heat_id', normalizedHeatId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (!data) return null;

      // Map back to legacy format for compatibility
      return {
        heat_id: data.heat_id,
        is_running: data.status === 'running',
        start_time: data.timer_start_time,
        duration_minutes: data.timer_duration_minutes
      };
    } catch (error) {
      console.error('❌ Erreur chargement timer:', error);
      return null;
    }
  }, []);

  // Mettre à jour le statut d'un heat
  const updateHeatStatus = useCallback(async (heatId: string, status: 'open' | 'closed', closedAt?: string) => {
    try {
      await heatRepository.updateHeatStatus(heatId, status, closedAt);
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du heat:', error);
    }
  }, []);

  // Charger les scores depuis Supabase
  const loadScoresFromDatabase = useCallback(async (heatId: string, legacyHeatId?: string) => {
    try {
      const fetched = await scoreRepository.fetchScores(heatId, legacyHeatId);
      return normalizeScores(fetched, generateId);
    } catch (error) {
      console.log('⚠️ Scores non chargés depuis Supabase (mode local):', error instanceof Error ? error.message : error);
      return [];
    }
  }, []);

  // Initialiser la synchronisation au démarrage
  useEffect(() => {
    if (canReachSupabase() && isSupabaseConfigured()) {
      syncPendingScores();
      syncOverrideLogs();
      syncOffline();
    }

    // Compter les scores en attente au chargement et sur màj
    const checkPendingScores = () => {
      const localScores = localStorage.getItem('surfJudgingScores');
      if (localScores) {
        const scores: Score[] = normalizeScores(JSON.parse(localScores), generateId);
        updatePendingCount(scores);
      }
    };
    
    checkPendingScores();
    window.addEventListener('localScoresUpdated', checkPendingScores);
    
    return () => {
      window.removeEventListener('localScoresUpdated', checkPendingScores);
    };
  }, [syncPendingScores, updatePendingCount, syncOverrideLogs]);

  return {
    syncStatus,
    createHeat,
    updateHeatStatus,
    loadScoresFromDatabase,
    syncPendingScores,
    saveHeatConfig,
    saveTimerState,
    loadHeatConfig,
    loadTimerState,
  };
}
