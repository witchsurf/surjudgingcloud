import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, canUseSupabaseConnection, isLocalSupabaseMode, syncOffline } from '../lib/supabase';
import type { Score, Heat, ScoreOverrideLog, OverrideReason } from '../types';
import type { AppConfig, HeatTimer } from '../types';
import { ensureHeatId, buildHeatId } from '../utils/heat';
import { heatRepository, timerRepository } from '../repositories';

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

  const persistScores = useCallback((scores: Score[]) => {
    const normalizedScores = normalizeScores(scores, generateId);
    localStorage.setItem('surfJudgingScores', JSON.stringify(normalizedScores));
    updatePendingCount(normalizedScores);
  }, [updatePendingCount]);

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

  const ensureHeatRecord = useCallback(async (
    heatId: string,
    competition: string,
    division: string,
    round: number
  ) => {
    const normalizedHeatId = ensureHeatId(heatId);
    if (!canReachSupabase() || !supabaseEnabled || !isSupabaseConfigured()) {
      return;
    }

    try {
      const { data, error } = await supabase!
        .from('heats')
        .select('id')
        .eq('id', normalizedHeatId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        return;
      }

      // Get event_id from localStorage
      const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
      const eventId = eventIdRaw ? parseInt(eventIdRaw, 10) : null;

      if (!eventId || isNaN(eventId)) {
        console.warn('⚠️ Cannot create heat record: event_id not found in localStorage');
        return;
      }

      const heatNumber = extractHeatNumber(normalizedHeatId) ?? extractHeatNumber(heatId) ?? 1;
      const payload = {
        id: normalizedHeatId,
        event_id: eventId,
        competition,
        division,
        round,
        heat_number: heatNumber,
        status: 'open' as const,
        created_at: new Date().toISOString()
      };

      console.log('📝 Creating heat record:', payload);

      const { error: insertError } = await supabase!
        .from('heats')
        .insert(payload);

      if (insertError && insertError.code !== '23505') {
        console.error('❌ Failed to create heat record:', insertError);
        throw insertError;
      }

      console.log('✅ Heat record created successfully');
    } catch (error) {
      console.error('❌ Erreur ensureHeatRecord:', error);
    }
  }, [supabaseEnabled]);

  const markAllScoresSynced = useCallback(() => {
    const localScores = localStorage.getItem('surfJudgingScores');
    if (!localScores) {
      updatePendingCount([]);
      return;
    }

    try {
      const scores: Score[] = normalizeScores(JSON.parse(localScores), generateId);
      const syncedScores = scores.map(score => ({ ...score, synced: true }));
      persistScores(syncedScores);
    } catch (error) {
      console.error('❌ Erreur lors du marquage local des scores synchronisés:', error);
    }
  }, [persistScores, updatePendingCount]);

  const syncOverrideLogs = useCallback(async () => {
    if (!canReachSupabase() || !supabaseEnabled) return;

    const localLogs = readLocalOverrideLogs();
    const pendingLogs = localLogs.filter(log => !log.synced);
    if (pendingLogs.length === 0) return;

    try {
      const payload = pendingLogs.map(log => ({
        id: log.id,
        heat_id: log.heat_id,
        score_id: log.score_id,
        judge_id: log.judge_id,
        judge_name: log.judge_name,
        surfer: log.surfer,
        wave_number: log.wave_number,
        previous_score: log.previous_score,
        new_score: log.new_score,
        reason: log.reason,
        comment: log.comment,
        overridden_by: log.overridden_by,
        overridden_by_name: log.overridden_by_name,
        created_at: log.created_at
      }));

      const { error } = await supabase!
        .from('score_overrides')
        .upsert(payload, { onConflict: 'id' });

      if (error) throw error;

      const merged = localLogs.map(log => ({ ...log, synced: true }));
      writeLocalOverrideLogs(merged);
    } catch (error) {
      console.error('❌ Synchronisation overrides échouée:', error);
    }
  }, [supabaseEnabled, readLocalOverrideLogs, writeLocalOverrideLogs]);

  // Synchroniser les scores en attente
  const syncPendingScores = useCallback(async () => {
    if (!canReachSupabase() || !supabaseEnabled) {
      markAllScoresSynced();
      return;
    }

    try {
      // Récupérer les scores non synchronisés du localStorage
      const localScores = localStorage.getItem('surfJudgingScores');
      if (!localScores) return;

      const scores: Score[] = normalizeScores(JSON.parse(localScores));
      const pendingScores = scores.filter(score => !score.synced);

      if (pendingScores.length === 0) return;

      const uniqueHeatMeta = Array.from(
        new Map(
          pendingScores.map(score => [score.heat_id, {
            heatId: score.heat_id,
            competition: score.competition,
            division: score.division,
            round: score.round
          }])
        ).values()
      );

      await Promise.all(
        uniqueHeatMeta.map(meta =>
          ensureHeatRecord(meta.heatId, meta.competition, meta.division, meta.round)
        )
      );

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
        })), { onConflict: 'id' });

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
  }, [supabaseEnabled, markAllScoresSynced, persistScores, ensureHeatRecord]);

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

  // Sauvegarder un score (local + sync si en ligne)
  const saveScore = useCallback(async (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp' | 'synced'>, heatId: string) => {
    const normalizedHeatId = ensureHeatId(heatId);
    const newScore: Score = {
      ...scoreData,
      competition: scoreData.competition || '',
      division: scoreData.division || '',
      round: scoreData.round ?? 0,
      id: generateId(),
      heat_id: normalizedHeatId,
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
      synced: false
    };

    // Get event_id from localStorage for the score
    const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
    const eventId = eventIdRaw ? parseInt(eventIdRaw, 10) : undefined;

    // Sauvegarder localement d'abord
    const rawScores = localStorage.getItem('surfJudgingScores');
    const existingScores: Score[] = rawScores ? normalizeScores(JSON.parse(rawScores)) : [];
    const updatedScores = [...existingScores, newScore];
    persistScores(updatedScores);

    // Essayer de synchroniser immédiatement si en ligne
    if (canReachSupabase() && supabaseEnabled) {
      try {
        await ensureHeatRecord(newScore.heat_id, newScore.competition, newScore.division, newScore.round);

        const { error } = await supabase!
          .from('scores')
          .upsert({
            id: newScore.id,
            heat_id: newScore.heat_id,
            event_id: eventId, // ✅ CRITICAL FIX: Link score to event for RLS/Admin visibility
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
          }, { onConflict: 'id' });

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
        console.log('⚠️ Score sauvé localement, synchronisation différée', error instanceof Error ? error.message : error);
      }
    } else {
      // BUG FIX: Mark as NOT synced so it can be picked up by sync worker later
      newScore.synced = false;
      const unsyncedScores = updatedScores.map(s => s.id === newScore.id ? newScore : s);
      persistScores(unsyncedScores);
    }

    return newScore;
  }, [persistScores, supabaseEnabled, ensureHeatRecord]);

  interface ScoreOverrideInput {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
    surfer: string;
    waveNumber: number;
    newScore: number;
    reason: OverrideReason;
    comment?: string;
  }

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

  const overrideScore = useCallback(async (input: ScoreOverrideInput) => {
    const {
      heatId,
      competition,
      division,
      round,
      judgeId,
      judgeName,
      surfer,
      waveNumber,
      newScore,
      reason,
      comment
    } = input;

    const normalizedHeatId = ensureHeatId(heatId);
    const now = new Date();
    const storedScores = localStorage.getItem('surfJudgingScores') || '[]';
    const localScores: Score[] = normalizeScores(JSON.parse(storedScores));
    const matchIndex = localScores.findIndex(
      score =>
        ensureHeatId(score.heat_id) === normalizedHeatId &&
        score.judge_id === judgeId &&
        score.wave_number === waveNumber &&
        score.surfer === surfer
    );

    const existingScore = matchIndex >= 0 ? localScores[matchIndex] : undefined;
    const scoreId = existingScore?.id ?? generateId();
    const updatedScore: Score = {
      id: scoreId,
      heat_id: normalizedHeatId,
      competition,
      division,
      round,
      judge_id: judgeId,
      judge_name: judgeName,
      surfer,
      wave_number: waveNumber,
      score: newScore,
      timestamp: now.toISOString(),
      created_at: existingScore?.created_at ?? now.toISOString(),
      synced: supabaseEnabled && canReachSupabase() ? existingScore?.synced ?? true : true
    };

    if (matchIndex >= 0) {
      localScores[matchIndex] = updatedScore;
    } else {
      localScores.push(updatedScore);
    }
    persistScores(localScores);

    const logBase: LocalOverrideLog = {
      id: generateId(),
      heat_id: normalizedHeatId,
      score_id: scoreId!,
      judge_id: judgeId,
      judge_name: judgeName,
      surfer,
      wave_number: waveNumber,
      previous_score: existingScore ? existingScore.score : null,
      new_score: newScore,
      reason,
      comment,
      overridden_by: 'chief_judge',
      overridden_by_name: 'Chef Judge',
      created_at: now.toISOString(),
      synced: false
    };

    if (canReachSupabase() && supabaseEnabled) {
      try {
        await ensureHeatRecord(normalizedHeatId, competition, division, round);

        const scorePayload = {
          id: scoreId,
          heat_id: normalizedHeatId,
          competition,
          division,
          round,
          judge_id: judgeId,
          judge_name: judgeName,
          surfer,
          wave_number: waveNumber,
          score: newScore,
          timestamp: updatedScore.timestamp,
          created_at: updatedScore.created_at
        };

        const { error: scoreError } = await supabase!
          .from('scores')
          .upsert(scorePayload, { onConflict: 'id' });

        if (scoreError) throw scoreError;

        const { error: logError } = await supabase!
          .from('score_overrides')
          .upsert({
            id: logBase.id,
            heat_id: logBase.heat_id,
            score_id: logBase.score_id,
            judge_id: logBase.judge_id,
            judge_name: logBase.judge_name,
            surfer: logBase.surfer,
            wave_number: logBase.wave_number,
            previous_score: logBase.previous_score,
            new_score: logBase.new_score,
            reason: logBase.reason,
            comment: logBase.comment,
            overridden_by: logBase.overridden_by,
            overridden_by_name: logBase.overridden_by_name,
            created_at: logBase.created_at
          }, { onConflict: 'id' });

        if (logError) throw logError;

        logBase.synced = true;
      } catch (error) {
        console.error('❌ Erreur override Supabase:', error);
      }
    }

    const localLogs = readLocalOverrideLogs();
    const mergedLogs = [logBase, ...localLogs.filter(log => log.id !== logBase.id)];
    writeLocalOverrideLogs(mergedLogs);

    return {
      updatedScore,
      previousScore: existingScore,
      log: logBase as ScoreOverrideLog
    };
  }, [persistScores, supabaseEnabled, readLocalOverrideLogs, writeLocalOverrideLogs, ensureHeatRecord]);

  const loadOverrideLogs = useCallback(async (heatId: string): Promise<ScoreOverrideLog[]> => {
    const normalizedHeatId = ensureHeatId(heatId);
    const localLogs = readLocalOverrideLogs().filter(log => log.heat_id === normalizedHeatId);
    let remoteLogs: ScoreOverrideLog[] = [];

    if (canReachSupabase() && supabaseEnabled) {
      try {
        const { data, error } = await supabase!
          .from('score_overrides')
          .select('*')
          .eq('heat_id', normalizedHeatId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        remoteLogs = ((data || []) as ScoreOverrideLog[]).map((log) => ({
          ...log,
          heat_id: ensureHeatId(log.heat_id),
        }));
      } catch (error) {
        console.error('❌ Erreur chargement override logs:', error);
      }
    }

    const mergedById = new Map<string, ScoreOverrideLog>();
    [...remoteLogs, ...localLogs].forEach(log => {
      mergedById.set(log.id, { ...log });
    });

    return Array.from(mergedById.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [readLocalOverrideLogs, supabaseEnabled]);

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
          await supabase!
            .from('heat_realtime_config')
            .upsert({ heat_id: newHeat.id }, { onConflict: 'heat_id', ignoreDuplicates: true });
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

    try {
      await heatRepository.saveHeatConfig(normalizedHeatId, {
        judges: config.judges,
        surfers: config.surfers,
        judge_names: config.judgeNames,
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
      return data;
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
    if (!canReachSupabase()) {
      console.log('⚠️ Scores non chargés: hors ligne');
      return [];
    }

    if (!isSupabaseConfigured()) {
      console.log('⚠️ Scores non chargés: Supabase non configuré');
      return [];
    }

    try {
      const normalizedHeatId = ensureHeatId(heatId);
      const ids = new Set<string>([normalizedHeatId]);
      if (legacyHeatId) {
        ids.add(ensureHeatId(legacyHeatId));
      }

      const heatIds = Array.from(ids);
      const { data, error } = await supabase!
        .from('scores')
        .select('*')
        .in('heat_id', heatIds)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return normalizeScores((data || []) as Score[], generateId);
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

    // Compter les scores en attente
    const localScores = localStorage.getItem('surfJudgingScores');
    if (localScores) {
      const scores: Score[] = normalizeScores(JSON.parse(localScores), generateId);
      updatePendingCount(scores);
    }
  }, [syncPendingScores, updatePendingCount, syncOverrideLogs]);

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
    loadTimerState,
    overrideScore,
    loadOverrideLogs
  };
}
