import React, { useCallback, useEffect, useState } from 'react';
import { Settings, Clock, Users, Download, RotateCcw, Trash2, Database, CheckCircle, ArrowRight, ClipboardCheck, AlertCircle, Info as InfoIcon, Eye, FileText, PlusCircle, Trophy, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import HeatTimer from './HeatTimer';
import type { AppConfig, HeatTimer as HeatTimerType, Score, ScoreOverrideLog, OverrideReason, InterferenceType } from '../types';
import { validateScore } from '../utils/scoring';
import { buildJudgeDeviationDetails, calculateJudgeAccuracy, calculateSurferStats } from '../utils/scoring';
import { computeEffectiveInterferences } from '../utils/interference';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { SURFER_COLORS as SURFER_COLOR_MAP } from '../utils/constants';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { exportHeatScorecardPdf, exportFullCompetitionPDF } from '../utils/pdfExport';
import { fetchHeatScores, fetchEventIdByName, fetchOrderedHeatSequence, fetchAllEventHeats, fetchAllEventCategories, fetchPreferredScoresForEvent, fetchEventJudgeAssignmentCoverage, fetchEventJudgeAccuracySummary, fetchAllInterferenceCallsForEvent, fetchHeatEntriesWithParticipants, fetchHeatSlotMappings, fetchInterferenceCalls, replaceHeatEntries, ensureEventExists, upsertInterferenceCall, fetchActiveJudges, fetchEventJudgeAssignments, createJudge } from '../api/supabaseClient';
import type { Judge, HeatJudgeAssignmentRow, EventJudgeAssignmentCoverageRow, EventJudgeAccuracySummaryRow } from '../api/supabaseClient';
import { supabase, isSupabaseConfigured, getSupabaseConfig, getSupabaseMode, isLocalSupabaseMode } from '../lib/supabase';
import { isPrivateHostname } from '../utils/network';
import { TimerAudio } from '../utils/audioUtils';
import { canonicalizeScores } from '../api/modules/scoring.api';

const ACTIVE_EVENT_STORAGE_KEY = 'surfJudgingActiveEventId';

const generateJudgePersonalCode = () => Math.floor(100000 + Math.random() * 900000).toString();


interface AdminInterfaceProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onConfigSaved: (saved: boolean) => void;
  configSaved: boolean;
  timer: HeatTimerType;
  onTimerChange: (timer: HeatTimerType) => void;
  onReloadData: () => void;
  onResetAllData: () => void;
  onCloseHeat: () => void;
  judgeWorkCount: Record<string, number>;
  scores: Score[];
  overrideLogs: ScoreOverrideLog[];
  heatStatus?: 'waiting' | 'running' | 'paused' | 'finished' | 'closed';
  onScoreOverride: (input: {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
    judgeStation?: string;
    judgeIdentityId?: string;
    surfer: string;
    waveNumber: number;
    newScore: number;
    reason: OverrideReason;
    comment?: string;
  }) => Promise<ScoreOverrideLog | undefined>;
  onRealtimeTimerStart?: (heatId: string, config: AppConfig, duration: number) => Promise<void>;
  onRealtimeTimerPause?: (heatId: string, remainingDuration?: number) => Promise<void>;
  onRealtimeTimerReset?: (heatId: string, duration: number) => Promise<void>;
  availableDivisions?: string[];
  loadState?: 'loading' | 'loaded' | 'empty' | 'error';
  loadedFromDb?: boolean;
  activeEventId?: number;
  onReconnectToDb?: () => Promise<void>;
}
const AdminInterface: React.FC<AdminInterfaceProps> = ({
  config,
  onConfigChange,
  onConfigSaved,
  configSaved,
  timer,
  onTimerChange,
  onReloadData,
  onResetAllData,
  onCloseHeat,
  judgeWorkCount,
  scores,
  overrideLogs,
  heatStatus = 'waiting',
  onScoreOverride,
  onRealtimeTimerStart,
  onRealtimeTimerPause,
  onRealtimeTimerReset,
  availableDivisions = [],
  loadState = 'loaded',
  loadedFromDb = false,
  activeEventId,
  onReconnectToDb
}) => {
  const navigate = useNavigate();
  const timerAudio = TimerAudio.getInstance();
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [selectedJudge, setSelectedJudge] = useState('');
  const [selectedSurfer, setSelectedSurfer] = useState('');
  const [selectedWave, setSelectedWave] = useState<number | ''>('');
  const [moveTargetSurfer, setMoveTargetSurfer] = useState('');
  const [moveTargetWave, setMoveTargetWave] = useState<number | ''>('');
  const [scoreInput, setScoreInput] = useState('');
  const [showOverridePanel, setShowOverridePanel] = useState(false);
  const [overrideReason, setOverrideReason] = useState<OverrideReason>('correction');
  const [overrideComment, setOverrideComment] = useState('');
  const [correctionMode, setCorrectionMode] = useState<'score' | 'interference'>('score');
  const [interferenceType, setInterferenceType] = useState<InterferenceType>('INT1');
  const [headJudgeOverride, setHeadJudgeOverride] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [overridePending, setOverridePending] = useState(false);
  const [divisionOptions, setDivisionOptions] = useState<string[]>([]);
  const [eventDivisionOptions, setEventDivisionOptions] = useState<string[]>([]);
  const [divisionHeatSequence, setDivisionHeatSequence] = useState<Array<{ round: number; heat_number: number; status?: string }>>([]);
  const [displayLinkCopied, setDisplayLinkCopied] = useState(false);
  const [priorityLinkCopied, setPriorityLinkCopied] = useState(false);
  const [eventPdfPending, setEventPdfPending] = useState(false);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [offlineAdminPin, setOfflineAdminPin] = useState(() => {
    try {
      return localStorage.getItem('admin_offline_pin') || '';
    } catch {
      return '';
    }
  });
  const [reconnectPending, setReconnectPending] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);
  const [plannedTimerDuration, setPlannedTimerDuration] = useState<number>(timer.duration);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [dbHeatScores, setDbHeatScores] = useState<Score[]>([]);
  const [dbHeatScoreHistory, setDbHeatScoreHistory] = useState<Score[]>([]);
  const [analyticsScope, setAnalyticsScope] = useState<'heat' | 'event'>('heat');
  const [eventAccuracyScores, setEventAccuracyScores] = useState<Score[]>([]);
  const [eventAccuracyOverrides, setEventAccuracyOverrides] = useState<ScoreOverrideLog[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [selectedJudgeProfileId, setSelectedJudgeProfileId] = useState<string | null>(null);
  const [showClosedHeats, setShowClosedHeats] = useState(false);
  const [allEventHeatsMeta, setAllEventHeatsMeta] = useState<Array<{ division: string; round: number; heat_number: number; status: string }>>([]);
  const [isTimerOpen, setIsTimerOpen] = useState(true);
  const [floatingTimerTick, setFloatingTimerTick] = useState(Date.now());
  const [availableOfficialJudges, setAvailableOfficialJudges] = useState<Judge[]>([]);
  const [officialJudgeStatus, setOfficialJudgeStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [creatingOfficialJudgeFor, setCreatingOfficialJudgeFor] = useState<string | null>(null);
  const [eventJudgeAssignments, setEventJudgeAssignments] = useState<HeatJudgeAssignmentRow[]>([]);
  const [assignmentCoverageRows, setAssignmentCoverageRows] = useState<EventJudgeAssignmentCoverageRow[]>([]);
  const [eventJudgeAccuracySummary, setEventJudgeAccuracySummary] = useState<EventJudgeAccuracySummaryRow[]>([]);
  // Stable latch: once a heat is locked/closed, never flicker back to unlocked within session
  const hasBeenLockedRef = React.useRef(false);
  // Track which heat the latch was set for, so we can reset on heat change
  const lockedForHeatRef = React.useRef<string>('');

  const resolveAssignedJudgeIdentity = useCallback((stationId: string) => {
    return (config.judgeIdentities?.[stationId] || '').trim();
  }, [config.judgeIdentities]);

  const buildIdentityAssignmentMap = useCallback((assignments: HeatJudgeAssignmentRow[]) => {
    return assignments.reduce<Map<string, { judgeId: string; judgeName: string }>>((acc, assignment) => {
      const heatId = ensureHeatId(assignment.heat_id);
      const station = (assignment.station || '').trim().toUpperCase();
      const judgeId = (assignment.judge_id || '').trim();
      if (!heatId || !station || !judgeId) return acc;
      acc.set(`${heatId}::${station}`, {
        judgeId,
        judgeName: (assignment.judge_name || assignment.station || assignment.judge_id || '').trim() || judgeId
      });
      return acc;
    }, new Map());
  }, []);

  const remapScoresToJudgeIdentity = useCallback((sourceScores: Score[], identityMap: Map<string, { judgeId: string; judgeName: string }>) => {
    return sourceScores.map((score) => {
      if (score.judge_identity_id) {
        return {
          ...score,
          judge_id: score.judge_identity_id,
          judge_name: (score.judge_name || '').trim() || score.judge_id,
        };
      }
      const station = (score.judge_station || score.judge_id || '').trim().toUpperCase();
      const key = `${ensureHeatId(score.heat_id)}::${station}`;
      const identity = identityMap.get(key);
      if (!identity) return score;
      return {
        ...score,
        judge_id: identity.judgeId,
        judge_name: identity.judgeName,
      };
    });
  }, []);

  const remapOverrideLogsToJudgeIdentity = useCallback((sourceLogs: ScoreOverrideLog[], identityMap: Map<string, { judgeId: string; judgeName: string }>) => {
    return sourceLogs.map((log) => {
      if (log.judge_identity_id) {
        return {
          ...log,
          judge_id: log.judge_identity_id,
          judge_name: (log.judge_name || '').trim() || log.judge_id,
        };
      }
      const station = (log.judge_station || log.judge_id || '').trim().toUpperCase();
      const key = `${ensureHeatId(log.heat_id)}::${station}`;
      const identity = identityMap.get(key);
      if (!identity) return log;
      return {
        ...log,
        judge_id: identity.judgeId,
        judge_name: identity.judgeName,
      };
    });
  }, []);

  const isLockedStatus = useCallback((status?: string | null) => {
    const normalized = status?.toString().trim().toLowerCase();
    // Only 'closed' (explicit head-judge action) locks the heat.
    // 'finished' = timer expired; judges may still score during review.
    return normalized === 'closed';
  }, []);

  const getRemainingTimerSeconds = useCallback((currentTimer: HeatTimerType, nowMs: number = Date.now()) => {
    if (!currentTimer.startTime) {
      return Math.max(0, Math.floor(currentTimer.duration * 60));
    }

    const startMs = new Date(currentTimer.startTime).getTime();
    const elapsed = Math.floor((nowMs - startMs) / 1000);
    return Math.max(0, Math.floor(currentTimer.duration * 60) - elapsed);
  }, []);

  useEffect(() => {
    if (!timer.isRunning || isTimerOpen) return;

    setFloatingTimerTick(Date.now());
    const interval = window.setInterval(() => {
      setFloatingTimerTick(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [timer.isRunning, isTimerOpen]);

  const loadOfficialJudges = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setAvailableOfficialJudges([]);
      return [] as Judge[];
    }

    try {
      const judges = await fetchActiveJudges();
      setAvailableOfficialJudges(judges);
      return judges;
    } catch (error) {
      console.warn('Impossible de charger les juges officiels:', error);
      setAvailableOfficialJudges([]);
      return [] as Judge[];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const judges = await loadOfficialJudges();
      if (cancelled) {
        return;
      }
      setAvailableOfficialJudges(judges);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadOfficialJudges]);

  useEffect(() => {
    let cancelled = false;

    const loadEventAssignments = async () => {
      if (!activeEventId || !isSupabaseConfigured()) {
        if (!cancelled) {
          setEventJudgeAssignments([]);
          setAssignmentCoverageRows([]);
        }
        return;
      }

      try {
        const [assignments, coverage] = await Promise.all([
          fetchEventJudgeAssignments(activeEventId),
          fetchEventJudgeAssignmentCoverage(activeEventId).catch((error) => {
            if (error instanceof Error && error.message.startsWith('VIEW_NOT_READY:')) {
              return [];
            }
            throw error;
          })
        ]);
        if (!cancelled) {
          setEventJudgeAssignments(assignments);
          setAssignmentCoverageRows(coverage);
        }
      } catch (error) {
        console.warn('Impossible de charger les affectations officielles de l’événement:', error);
        if (!cancelled) {
          setEventJudgeAssignments([]);
          setAssignmentCoverageRows([]);
        }
      }
    };

    void loadEventAssignments();
    return () => {
      cancelled = true;
    };
  }, [activeEventId]);

  const formatMinSec = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!activeEventId || !supabase) {
      setAllEventHeatsMeta([]);
      return;
    }
    let cancelled = false;
    const loadMeta = async () => {
      const { data, error } = await supabase!
        .from('heats')
        .select('division, round, heat_number, status')
        .eq('event_id', activeEventId)
        .order('division', { ascending: true })
        .order('round', { ascending: true })
        .order('heat_number', { ascending: true });
      if (error) {
        console.warn('Impossible de charger les métadonnées des heats:', error);
        if (!cancelled) {
          setAllEventHeatsMeta([]);
        }
        return;
      }
      if (!cancelled && data) {
        setAllEventHeatsMeta(data);
      }
    };
    loadMeta();
    return () => { cancelled = true; };
  }, [activeEventId, config.division, config.round, config.heatId]);

  const { normalized: heatId } = React.useMemo(
    () =>
      getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
      ),
    [config.competition, config.division, config.round, config.heatId]
  );

  useEffect(() => {
    setPlannedTimerDuration(timer.duration);
  }, [heatId]);

  const reasonLabels: Record<OverrideReason, string> = {
    correction: 'Correction',
    omission: 'Omission',
    probleme: 'Problème technique'
  };

  function normalizeJerseyLabel(value?: string | null): string {
    const raw = (value || '').toUpperCase().trim();
    if (!raw) return '';
    return colorLabelMap[(raw as HeatColor)] ?? raw;
  }

  const mergedScores = React.useMemo(() => {
    const byLogicalKey = new Map<string, Score>();
    const allScores = [...(scores || []), ...(dbHeatScores || [])];

    allScores.forEach((score) => {
      const key = `${ensureHeatId(score.heat_id)}::${(score.judge_id || '').trim().toUpperCase()}::${normalizeJerseyLabel(score.surfer)}::${Number(score.wave_number)}`;
      const existing = byLogicalKey.get(key);
      if (!existing) {
        byLogicalKey.set(key, score);
        return;
      }

      const existingTs = new Date(existing.created_at || existing.timestamp || 0).getTime();
      const nextTs = new Date(score.created_at || score.timestamp || 0).getTime();
      if (nextTs >= existingTs) {
        byLogicalKey.set(key, score);
      }
    });

    return Array.from(byLogicalKey.values());
  }, [scores, dbHeatScores]);

  useEffect(() => {
    let cancelled = false;
    let pollingInterval: ReturnType<typeof setInterval> | null = null;

    const loadDbScores = async () => {
      try {
        if (!supabase) throw new Error('Supabase non initialisé');
        const { data, error } = await supabase
          .from('scores')
          .select('*')
          .eq('heat_id', heatId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        const nextScores = (data || []) as Score[];
        if (!cancelled) {
          setDbHeatScoreHistory(nextScores);
          setDbHeatScores(canonicalizeScores(nextScores));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('⚠️ Impossible de charger les scores DB pour le panel admin:', error);
          setDbHeatScores([]);
          setDbHeatScoreHistory([]);
        }
      }
    };

    loadDbScores();

    const handleRealtimeScore = (event: Event) => {
      const detail = (event as CustomEvent<Partial<Score>>).detail;
      if (!detail?.heat_id) return;
      if (ensureHeatId(detail.heat_id) !== heatId) return;
      void loadDbScores();
    };

    window.addEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
    if (isLocalSupabaseMode()) {
      pollingInterval = setInterval(() => {
        void loadDbScores();
      }, 2500);
    }
    return () => {
      cancelled = true;
      window.removeEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [heatId]);

  const currentScore = React.useMemo(() => {
    if (!selectedJudge || !selectedSurfer || !selectedWave) return undefined;
    const selectedSurferKey = normalizeJerseyLabel(selectedSurfer);
    // Resolve UUID from station, with safe case-insensitive lookup
    const safeIdentities = Object.fromEntries(
      Object.entries(config.judgeIdentities || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
    );
    const resolvedJudgeId = safeIdentities[selectedJudge.trim().toUpperCase()] || selectedJudge;
    return mergedScores
      .filter(score => {
        if (ensureHeatId(score.heat_id) !== heatId) return false;
        if (normalizeJerseyLabel(score.surfer) !== selectedSurferKey) return false;
        if (score.wave_number !== Number(selectedWave)) return false;
        // Match by UUID (judge_id) OR by station (judge_station) as fallback
        return score.judge_id === resolvedJudgeId
          || score.judge_station === selectedJudge
          || score.judge_id === selectedJudge;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }, [mergedScores, heatId, selectedJudge, selectedSurfer, selectedWave, config.judgeIdentities]);

  const heatScoreHistory = React.useMemo(() => {
    const localScores = (() => {
      try {
        const raw = localStorage.getItem('surfJudgingScores');
        if (!raw) return [] as Score[];
        return (JSON.parse(raw) as Score[]).filter((score) => ensureHeatId(score.heat_id) === heatId);
      } catch {
        return [] as Score[];
      }
    })();

    const byId = new Map<string, Score>();
    [...localScores, ...dbHeatScoreHistory].forEach((score) => {
      if (!score.id) return;
      byId.set(score.id, score);
    });
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.created_at || a.timestamp || 0).getTime() - new Date(b.created_at || b.timestamp || 0).getTime()
    );
  }, [dbHeatScoreHistory, heatId]);

  const currentHeatIdentityMap = React.useMemo(() => {
    const assignments = (config.judges || []).map((station) => ({
      heat_id: heatId,
      event_id: activeEventId ?? null,
      station,
      judge_id: resolveAssignedJudgeIdentity(station) || station,
      judge_name: (config.judgeNames?.[station] || station).trim() || station,
    }));
    return buildIdentityAssignmentMap(assignments);
  }, [activeEventId, buildIdentityAssignmentMap, config.judgeNames, config.judges, heatId, resolveAssignedJudgeIdentity]);

  const analyticsHeatScores = React.useMemo(
    () => remapScoresToJudgeIdentity(canonicalizeScores(heatScoreHistory), currentHeatIdentityMap),
    [currentHeatIdentityMap, heatScoreHistory, remapScoresToJudgeIdentity]
  );

  const analyticsHeatOverrides = React.useMemo(
    () => remapOverrideLogsToJudgeIdentity(overrideLogs, currentHeatIdentityMap),
    [currentHeatIdentityMap, overrideLogs, remapOverrideLogsToJudgeIdentity]
  );

  const eventIdentityMap = React.useMemo(
    () => buildIdentityAssignmentMap(eventJudgeAssignments),
    [buildIdentityAssignmentMap, eventJudgeAssignments]
  );

  const analyticsEventScores = React.useMemo(
    () => remapScoresToJudgeIdentity(eventAccuracyScores, eventIdentityMap),
    [eventAccuracyScores, eventIdentityMap, remapScoresToJudgeIdentity]
  );

  const analyticsEventOverrides = React.useMemo(
    () => remapOverrideLogsToJudgeIdentity(eventAccuracyOverrides, eventIdentityMap),
    [eventAccuracyOverrides, eventIdentityMap, remapOverrideLogsToJudgeIdentity]
  );

  const analyticsConfiguredJudgeIds = React.useMemo(() => {
    if (analyticsScope === 'event') {
      return Array.from(new Set(eventJudgeAssignments.map((assignment) => (assignment.judge_id || '').trim()).filter(Boolean)));
    }
    return (config.judges || []).map((station) => resolveAssignedJudgeIdentity(station) || station);
  }, [analyticsScope, config.judges, eventJudgeAssignments, resolveAssignedJudgeIdentity]);

  const localJudgeAccuracy = React.useMemo(
    () => calculateJudgeAccuracy(
      analyticsScope === 'event' ? analyticsEventScores : analyticsHeatScores,
      analyticsScope === 'event' ? analyticsEventOverrides : analyticsHeatOverrides,
      analyticsConfiguredJudgeIds
    ),
    [analyticsConfiguredJudgeIds, analyticsEventOverrides, analyticsEventScores, analyticsHeatOverrides, analyticsHeatScores, analyticsScope]
  );

  const judgeAccuracy = React.useMemo(() => {
    if (analyticsScope !== 'event' || !eventJudgeAccuracySummary.length) {
      return localJudgeAccuracy;
    }

    return eventJudgeAccuracySummary.map((row) => ({
      judgeId: row.judge_identity_id,
      scoredWaves: row.scored_waves,
      consensusSamples: row.consensus_samples,
      meanAbsDeviation: row.mean_abs_deviation,
      bias: row.bias,
      withinHalfPointRate: row.within_half_point_rate,
      overrideCount: row.override_count,
      overrideRate: row.override_rate,
      averageOverrideDelta: row.average_override_delta,
      qualityScore: row.quality_score,
      qualityBand: row.quality_band,
    }));
  }, [analyticsScope, eventJudgeAccuracySummary, localJudgeAccuracy]);

  const analyticsJudgeNames = React.useMemo(() => {
    const names = new Map<string, string>();

    availableOfficialJudges.forEach((judge) => {
      const judgeId = (judge.id || '').trim();
      const judgeName = (judge.name || '').trim();
      if (judgeId && judgeName) {
        names.set(judgeId, judgeName);
      }
    });

    const safeJudgeNames = Object.fromEntries(
      Object.entries(config.judgeNames || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
    );

    Object.entries(safeJudgeNames).forEach(([station, name]) => {
      if (station && name) names.set(station, name);
    });

    Object.entries(config.judgeIdentities || {}).forEach(([station, identityId]) => {
      const normalizedStation = station.trim().toUpperCase();
      const judgeName = (safeJudgeNames[normalizedStation] || config.judgeNames?.[station] || '').trim();
      if (identityId && judgeName) {
        // Store with original casing, lowercase, and uppercase to handle DB UUID casing variations
        names.set(identityId, judgeName);
        names.set(identityId.toLowerCase(), judgeName);
        names.set(identityId.toUpperCase(), judgeName);
      }
      // Also store by station so judgeWorkCount (keyed by station) resolves to names
      if (normalizedStation && judgeName) {
        names.set(normalizedStation, judgeName);
        names.set(station.trim(), judgeName);
      }
    });
    // Ensure station->name entries for judgeWorkCount
    Object.entries(config.judgeNames || {}).forEach(([station, name]) => {
      const trimmed = station.trim();
      if (trimmed && name) {
        names.set(trimmed, name.trim());
        names.set(trimmed.toUpperCase(), name.trim());
      }
    });

    [...analyticsHeatScores, ...analyticsEventScores, ...dbHeatScores, ...dbHeatScoreHistory].forEach((score) => {
      const judgeId = (score.judge_id || '').trim();
      const judgeName = (score.judge_name || '').trim();
      if (judgeId && judgeName && !names.has(judgeId)) {
        names.set(judgeId, judgeName);
      }
    });

    [...analyticsHeatOverrides, ...analyticsEventOverrides].forEach((log) => {
      const judgeId = (log.judge_id || '').trim();
      const judgeName = (log.judge_name || '').trim();
      if (judgeId && judgeName && !names.has(judgeId)) {
        names.set(judgeId, judgeName);
      }
    });

    eventJudgeAccuracySummary.forEach((row) => {
      const judgeId = (row.judge_identity_id || '').trim();
      const judgeName = (row.judge_display_name || '').trim();
      if (judgeId && judgeName && !names.has(judgeId)) {
        names.set(judgeId, judgeName);
      }
    });

    return names;
  }, [analyticsEventOverrides, analyticsEventScores, analyticsHeatOverrides, analyticsHeatScores, availableOfficialJudges, config.judgeIdentities, config.judgeNames, dbHeatScoreHistory, dbHeatScores, eventJudgeAccuracySummary]);

  useEffect(() => {
    if (!judgeAccuracy.length) {
      setSelectedJudgeProfileId(null);
      return;
    }

    if (!selectedJudgeProfileId || !judgeAccuracy.some((row) => row.judgeId === selectedJudgeProfileId)) {
      setSelectedJudgeProfileId(judgeAccuracy[0].judgeId);
    }
  }, [judgeAccuracy, selectedJudgeProfileId]);

  const selectedJudgeProfile = React.useMemo(
    () => judgeAccuracy.find((row) => row.judgeId === selectedJudgeProfileId) ?? null,
    [judgeAccuracy, selectedJudgeProfileId]
  );

  const selectedJudgeDeviations = React.useMemo(() => {
    if (!selectedJudgeProfileId) return [];
    const analysisScores = analyticsScope === 'event' ? analyticsEventScores : analyticsHeatScores;
    return buildJudgeDeviationDetails(analysisScores, selectedJudgeProfileId).slice(0, 8);
  }, [analyticsEventScores, analyticsHeatScores, analyticsScope, selectedJudgeProfileId]);

  const selectedJudgeOverrides = React.useMemo(() => {
    if (!selectedJudgeProfileId) return [];
    const sourceLogs = analyticsScope === 'event' ? analyticsEventOverrides : analyticsHeatOverrides;
    return sourceLogs.filter((log) => log.judge_id === selectedJudgeProfileId);
  }, [analyticsEventOverrides, analyticsHeatOverrides, analyticsScope, selectedJudgeProfileId]);

  const selectedJudgeOverrideSummary = React.useMemo(() => {
    const summary = {
      correction: 0,
      omission: 0,
      probleme: 0,
    };

    selectedJudgeOverrides.forEach((log) => {
      summary[log.reason] += 1;
    });

    return summary;
  }, [selectedJudgeOverrides]);

  useEffect(() => {
    let cancelled = false;

    const loadEventAccuracyData = async () => {
      if (analyticsScope !== 'event' || !activeEventId || !supabase) {
        if (!cancelled) {
          setEventAccuracyScores([]);
          setEventAccuracyOverrides([]);
          setEventJudgeAccuracySummary([]);
        }
        return;
      }

      setAnalyticsLoading(true);
      try {
        const groupedScores = await fetchPreferredScoresForEvent(activeEventId);
        const nextScores = Object.values(groupedScores).flat();
        const nextSummary = await fetchEventJudgeAccuracySummary(activeEventId).catch((error) => {
          if (error instanceof Error && error.message.startsWith('VIEW_NOT_READY:')) {
            return [];
          }
          throw error;
        });

        const { data: heatRows, error: heatsError } = await supabase
          .from('heats')
          .select('id')
          .eq('event_id', activeEventId);

        if (heatsError) throw heatsError;
        const heatIds = (heatRows || []).map((row) => row.id).filter(Boolean);

        let nextOverrides: ScoreOverrideLog[] = [];
        if (heatIds.length > 0) {
          const { data: overrideRows, error: overridesError } = await supabase
            .from('score_overrides')
            .select('*')
            .in('heat_id', heatIds)
            .order('created_at', { ascending: false });

          if (overridesError) throw overridesError;
          nextOverrides = (overrideRows || []) as ScoreOverrideLog[];
        }

        if (!cancelled) {
          setEventAccuracyScores(nextScores);
          setEventAccuracyOverrides(nextOverrides);
          setEventJudgeAccuracySummary(nextSummary);
        }
      } catch (error) {
        console.warn('Impossible de charger les analytics de juges sur l’événement:', error);
        if (!cancelled) {
          setEventAccuracyScores([]);
          setEventAccuracyOverrides([]);
          setEventJudgeAccuracySummary([]);
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
        }
      }
    };

    void loadEventAccuracyData();
    return () => {
      cancelled = true;
    };
  }, [activeEventId, analyticsScope]);

  const handleExportJudgeAccuracy = useCallback(() => {
    if (!judgeAccuracy.length || typeof window === 'undefined') return;

    const lines = [
      ['scope', 'judge_id', 'judge_name', 'quality_score', 'quality_band', 'scored_waves', 'consensus_samples', 'mean_abs_deviation', 'bias', 'within_half_point_rate', 'override_count', 'override_rate', 'average_override_delta'].join(','),
      ...judgeAccuracy.map((row) => ([
        analyticsScope,
        row.judgeId,
        `"${(analyticsJudgeNames.get(row.judgeId) || row.judgeId).replace(/"/g, '""')}"`,
        row.qualityScore.toFixed(2),
        row.qualityBand,
        row.scoredWaves,
        row.consensusSamples,
        row.meanAbsDeviation.toFixed(2),
        row.bias.toFixed(2),
        row.withinHalfPointRate.toFixed(2),
        row.overrideCount,
        row.overrideRate.toFixed(2),
        row.averageOverrideDelta.toFixed(2),
      ].join(',')))
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `judge-accuracy-${analyticsScope}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [analyticsJudgeNames, analyticsScope, judgeAccuracy]);

  const handleOverrideSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (correctionMode === 'interference') {
      await handleInterferenceSubmit();
      return;
    }
    if (!selectedJudge || !selectedSurfer || !selectedWave) {
      setOverrideStatus({ type: 'error', message: 'Veuillez sélectionner juge, surfeur et vague.' });
      return;
    }
    const selectedSurferKey = normalizeJerseyLabel(selectedSurfer);

    const validation = validateScore(scoreInput);
    if (!validation.isValid || validation.value === undefined) {
      setOverrideStatus({ type: 'error', message: validation.error || 'Score invalide.' });
      return;
    }

    setOverridePending(true);
    try {
      // Build heat ID for the override
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

      const result = await onScoreOverride({
        heatId,
        competition: config.competition,
        division: config.division,
        round: config.round,
        judgeId: selectedJudge,
        judgeName: config.judgeNames[selectedJudge] || selectedJudge,
        judgeStation: selectedJudge,
        judgeIdentityId: config.judgeIdentities?.[selectedJudge],
        surfer: selectedSurferKey,
        waveNumber: Number(selectedWave),
        newScore: validation.value,
        reason: overrideReason,
        comment: overrideComment.trim() || undefined
      });

      if (result) {
        setOverrideStatus({
          type: 'success',
          message: `Note mise à jour à ${validation.value.toFixed(2)} (${reasonLabels[result.reason]})`
        });
      } else {
        setOverrideStatus({ type: 'success', message: 'Note mise à jour.' });
      }
    } catch (error) {
      console.error('❌ Override erreur:', error);
      setOverrideStatus({ type: 'error', message: 'Impossible d’enregistrer la correction.' });
    } finally {
      setOverridePending(false);
    }
  };

  const handleMoveScore = async () => {
    if (!currentScore?.id) {
      setOverrideStatus({ type: 'error', message: 'Aucune note sélectionnée à déplacer.' });
      return;
    }
    if (!moveTargetSurfer || !moveTargetWave) {
      setOverrideStatus({ type: 'error', message: 'Sélectionnez le surfeur et la vague de destination.' });
      return;
    }
    const moveTargetSurferKey = normalizeJerseyLabel(moveTargetSurfer);

    const safeIdentitiesMove = Object.fromEntries(
      Object.entries(config.judgeIdentities || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
    );
    const resolvedJudgeIdMove = safeIdentitiesMove[selectedJudge.trim().toUpperCase()] || selectedJudge;
    const targetAlreadyUsed = mergedScores.some(
      (score) =>
        ensureHeatId(score.heat_id) === heatId &&
        (score.judge_id === resolvedJudgeIdMove || score.judge_station === selectedJudge || score.judge_id === selectedJudge) &&
        normalizeJerseyLabel(score.surfer) === moveTargetSurferKey &&
        score.wave_number === Number(moveTargetWave) &&
        score.id !== currentScore.id
    );
    if (targetAlreadyUsed) {
      setOverrideStatus({
        type: 'error',
        message: 'Destination déjà notée pour ce juge. Supprimez/corrigez d’abord cette note.'
      });
      return;
    }

    setOverridePending(true);
    try {
      if (!supabase) throw new Error('Supabase non initialisé');
      const { error } = await supabase
        .from('scores')
        .update({
          surfer: moveTargetSurferKey,
          wave_number: Number(moveTargetWave),
          timestamp: new Date().toISOString()
        })
        .eq('id', currentScore.id);

      if (error) throw error;

      setOverrideStatus({
        type: 'success',
        message: `Note déplacée vers ${moveTargetSurferKey} · Vague ${moveTargetWave}.`
      });
      // Broadcast score change so judge tablets immediately refresh their grid
      window.dispatchEvent(new CustomEvent('scoreOverrideApplied', {
        detail: {
          heatId,
          judgeId: resolvedJudgeIdMove,
          action: 'move',
          fromSurfer: normalizeJerseyLabel(selectedSurfer),
          toSurfer: moveTargetSurferKey,
          wave: Number(moveTargetWave)
        }
      }));
      onReloadData();
    } catch (error) {
      console.error('❌ Move score erreur:', error);
      setOverrideStatus({ type: 'error', message: 'Impossible de déplacer la note.' });
    } finally {
      setOverridePending(false);
    }
  };

  const handleInterferenceSubmit = async () => {
    if (!selectedJudge || !selectedSurfer || !selectedWave) {
      setOverrideStatus({ type: 'error', message: 'Veuillez sélectionner juge, surfeur et vague.' });
      return;
    }
    const selectedSurferKey = normalizeJerseyLabel(selectedSurfer);
    if (!configSaved) {
      setOverrideStatus({ type: 'error', message: 'Veuillez d’abord sauvegarder la configuration du heat.' });
      return;
    }

    setOverridePending(true);
    try {
      const eventId = activeEventId ?? await fetchEventIdByName(config.competition);
      await upsertInterferenceCall({
        event_id: eventId,
        heat_id: heatId,
        competition: config.competition,
        division: config.division,
        round: config.round,
        judge_id: selectedJudge,
        judge_name: config.judgeNames[selectedJudge] || selectedJudge,
        surfer: selectedSurferKey,
        wave_number: Number(selectedWave),
        call_type: interferenceType,
        is_head_judge_override: headJudgeOverride,
      });

      setOverrideStatus({
        type: 'success',
        message: `Interférence ${interferenceType} enregistrée pour ${selectedSurferKey} (vague ${selectedWave}).`
      });
      onReloadData();
    } catch (error) {
      console.error('❌ Interférence admin erreur:', error);
      setOverrideStatus({ type: 'error', message: 'Impossible d’enregistrer l’interférence.' });
    } finally {
      setOverridePending(false);
    }
  };

  const encodedDisplayPayload = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const payload = {
        ...config,
        judgeNames: config.judgeNames,
        configSaved,
        heatStatus,
        timerSnapshot: {
          ...timer,
          startTime: timer.startTime ? timer.startTime.toISOString() : null
        }
      };
      return btoa(JSON.stringify(payload));
    } catch (error) {
      console.warn('Impossible de préparer la configuration affichage:', error);
      return null;
    }
  }, [config, configSaved, heatStatus, timer]);

  const publicDisplayUrl = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.origin);
    url.pathname = '/display';

    // Use eventId if available (Preferred for cross-device sync)
    if (activeEventId) {
      url.searchParams.set('eventId', activeEventId.toString());
    } else if (encodedDisplayPayload) {
      // Fallback to config payload (Legacy/Offline)
      url.searchParams.set('config', encodedDisplayPayload);
    }
    return url.toString();
  }, [encodedDisplayPayload, activeEventId]);

  const priorityJudgeUrl = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.origin);
    url.pathname = '/priority';

    if (activeEventId) {
      url.searchParams.set('eventId', activeEventId.toString());
    }

    return url.toString();
  }, [activeEventId]);

  const handleOpenDisplay = () => {
    if (!publicDisplayUrl) return;
    window.open(publicDisplayUrl, '_blank', 'noopener');
  };

  const handleCopyDisplayLink = async () => {
    if (!publicDisplayUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(publicDisplayUrl);
      setDisplayLinkCopied(true);
      window.setTimeout(() => setDisplayLinkCopied(false), 2000);
    } catch (error) {
      console.warn('Impossible de copier le lien affichage:', error);
    }
  };

  const handleCopyPriorityLink = async () => {
    if (!priorityJudgeUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(priorityJudgeUrl);
      setPriorityLinkCopied(true);
      window.setTimeout(() => setPriorityLinkCopied(false), 2000);
    } catch (error) {
      console.warn('Impossible de copier le lien priorité:', error);
    }
  };

  const handleAutoReconnect = async () => {
    if (!onReconnectToDb) return;
    setReconnectPending(true);
    setReconnectMessage(null);
    try {
      await onReconnectToDb();
      setReconnectMessage('✅ Reconnexion réussie: configuration rechargée depuis Supabase.');
      onReloadData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Impossible de recharger depuis Supabase.';
      setReconnectMessage(`❌ ${msg}`);
    } finally {
      setReconnectPending(false);
    }
  };

  // Évaluer le statut de la base de données
  React.useEffect(() => {
    const checkDbStatus = () => {
      const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
      const supabaseConfigured = Boolean(
        supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined'
      );

      if (!navigator.onLine) {
        setDbStatus('disconnected');
        return;
      }

      if (!supabaseConfigured) {
        setDbStatus('disconnected');
        return;
      }

      // Check if Supabase is actually accessible
      if (supabaseConfigured) {
        setDbStatus('connected');
      } else {
        setDbStatus('disconnected');
      }
    };

    setDbStatus('checking');
    const timeoutId = window.setTimeout(checkDbStatus, 300);

    const handleOnline = () => checkDbStatus();
    const handleOffline = () => setDbStatus('disconnected');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [configSaved]);

  const syncDivisionsFromParticipants = useCallback(() => {
    try {
      const stored = localStorage.getItem('participants');
      if (!stored) {
        if (divisionOptions.length) setDivisionOptions([]);
        return;
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        if (divisionOptions.length) setDivisionOptions([]);
        return;
      }
      const categories = Array.from(
        new Set(
          parsed
            .map((p: any) => (p?.category || '').toString().trim())
            .filter((cat: string) => cat.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      const arraysEqual =
        categories.length === divisionOptions.length &&
        categories.every((cat, idx) => cat === divisionOptions[idx]);
      if (!arraysEqual) {
        setDivisionOptions(categories);
      }

      const matchesCategory = (value: string) =>
        categories.some(cat => cat.toLowerCase() === value.toLowerCase());

      if (categories.length === 1 && !matchesCategory(config.division)) {
        onConfigChange({ ...config, division: categories[0] });
      } else if (categories.length > 1 && config.division && !matchesCategory(config.division)) {
        onConfigChange({ ...config, division: '' });
      }
    } catch (error) {
      console.warn('Impossible de lire les catégories participants:', error);
      if (divisionOptions.length) setDivisionOptions([]);
    }
  }, [divisionOptions, config, onConfigChange]);

  useEffect(() => {
    syncDivisionsFromParticipants();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'participants') {
        syncDivisionsFromParticipants();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [syncDivisionsFromParticipants]);

  const handleConfigChange = (field: keyof AppConfig, value: any) => {
    onConfigChange({ ...config, [field]: value });
  };

  useEffect(() => {
    let cancelled = false;
    const loadEventDivisions = async () => {
      if (!isSupabaseConfigured() || !config.competition) {
        setEventDivisionOptions([]);
        return;
      }

      try {
        let eventId = activeEventId ?? null;
        if (!eventId) {
          eventId = await fetchEventIdByName(config.competition);
        }
        if (!eventId) {
          if (!cancelled) setEventDivisionOptions([]);
          return;
        }

        const categories = await fetchAllEventCategories(eventId);
        if (!cancelled) {
          setEventDivisionOptions(categories);
        }
      } catch (error) {
        console.warn('Impossible de charger toutes les divisions de l’événement:', error);
        if (!cancelled) {
          setEventDivisionOptions([]);
        }
      }
    };

    loadEventDivisions();
    return () => {
      cancelled = true;
    };
  }, [activeEventId, config.competition]);

  useEffect(() => {
    let cancelled = false;
    const loadDivisionHeatSequence = async () => {
      if (!activeEventId || !config.division || !isSupabaseConfigured()) {
        setDivisionHeatSequence([]);
        return;
      }

      try {
        const sequence = await fetchOrderedHeatSequence(activeEventId, config.division);
        if (!cancelled) {
          setDivisionHeatSequence(sequence.map((row) => ({ round: row.round, heat_number: row.heat_number, status: row.status })));
        }
      } catch (error) {
        console.warn('Impossible de charger la structure round/heat pour la division:', error);
        if (!cancelled) {
          setDivisionHeatSequence([]);
        }
      }
    };

    loadDivisionHeatSequence();
    return () => {
      cancelled = true;
    };
  }, [activeEventId, config.division, config.round, config.heatId]);

  // Dropdowns visual states
  const isCategoryClosed = useCallback((div: string) => {
    const normalizedDivision = div.toLowerCase().trim();
    const divHeats = allEventHeatsMeta.filter(h => h.division.toLowerCase().trim() === normalizedDivision);
    return divHeats.length > 0 && divHeats.every(h => isLockedStatus(h.status));
  }, [allEventHeatsMeta, isLockedStatus]);

  const isRoundClosed = useCallback((rnd: number) => {
    const rHeats = divisionHeatSequence.filter(h => h.round === rnd);
    return rHeats.length > 0 && rHeats.every(h => isLockedStatus(h.status));
  }, [divisionHeatSequence, isLockedStatus]);

  const isHeatClosed = useCallback((heatNum: number, rnd: number) => {
    const heat = divisionHeatSequence.find(h => h.round === rnd && h.heat_number === heatNum);
    return heat ? isLockedStatus(heat.status) : false;
  }, [divisionHeatSequence, isLockedStatus]);

  const effectiveDivisionOptions = React.useMemo(() => {
    const fromEvent = (eventDivisionOptions || [])
      .map((value) => value?.toString().trim())
      .filter((value): value is string => Boolean(value));
    const fromStore = (availableDivisions || [])
      .map((value) => value?.toString().trim())
      .filter((value): value is string => Boolean(value));
    const fromParticipants = (divisionOptions || [])
      .map((value) => value?.toString().trim())
      .filter((value): value is string => Boolean(value));
    const merged = [...fromEvent, ...fromStore, ...fromParticipants];
    return Array.from(new Set(merged)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [eventDivisionOptions, availableDivisions, divisionOptions]);

  const activeDivisionOptions = React.useMemo(() => {
    if (showClosedHeats || allEventHeatsMeta.length === 0) return effectiveDivisionOptions;

    const openDivisions = new Set(
      allEventHeatsMeta
        .filter((heat) => !isLockedStatus(heat.status))
        .map((heat) => heat.division.toLowerCase().trim())
    );
    const filtered = effectiveDivisionOptions.filter((division) => openDivisions.has(division.toLowerCase().trim()));
    return filtered.length > 0 ? filtered : effectiveDivisionOptions;
  }, [effectiveDivisionOptions, showClosedHeats, allEventHeatsMeta, isLockedStatus]);

  const roundOptions = React.useMemo(() => {
    if (!divisionHeatSequence.length) return [config.round];
    return Array.from(new Set(divisionHeatSequence.map((row) => row.round))).sort((a, b) => a - b);
  }, [divisionHeatSequence, config.round]);

  const visibleRoundOptions = React.useMemo(() => {
    if (showClosedHeats) return roundOptions;
    const filtered = roundOptions.filter((round) => !isRoundClosed(round));
    return filtered.length > 0 ? filtered : roundOptions;
  }, [roundOptions, showClosedHeats, isRoundClosed]);

  const heatOptionsForRound = React.useMemo(() => {
    if (!divisionHeatSequence.length) return [config.heatId];
    const options = divisionHeatSequence
      .filter((row) => row.round === config.round)
      .map((row) => row.heat_number);
    const unique = Array.from(new Set(options)).sort((a, b) => a - b);
    return unique.length ? unique : [config.heatId];
  }, [divisionHeatSequence, config.round, config.heatId]);

  const visibleHeatOptions = React.useMemo(() => {
    if (showClosedHeats) return heatOptionsForRound;
    const filtered = heatOptionsForRound.filter((heat) => !isHeatClosed(heat, config.round));
    return filtered.length > 0 ? filtered : heatOptionsForRound;
  }, [heatOptionsForRound, showClosedHeats, isHeatClosed, config.round]);

  const currentHeatStatus = React.useMemo(() => {
    const row = divisionHeatSequence.find(h => h.round === config.round && h.heat_number === config.heatId);
    const dbStatus = (row?.status || '').toString().trim().toLowerCase();
    const liveStatus = (heatStatus || '').toString().trim().toLowerCase();

    // Prefer the live status when it is more restrictive than the DB sequence.
    if (liveStatus === 'closed' || liveStatus === 'finished') {
      return liveStatus;
    }

    return dbStatus || liveStatus || 'waiting';
  }, [divisionHeatSequence, config.round, config.heatId, heatStatus]);

  const isCurrentHeatLocked = isLockedStatus(currentHeatStatus);
  // Latch: once locked, never un-lock due to DB/realtime race — BUT reset when user switches heat
  const currentHeatKey = `${config.round}::${config.heatId}`;
  if (lockedForHeatRef.current !== currentHeatKey) {
    // User switched to a different heat — reset the latch
    hasBeenLockedRef.current = false;
    lockedForHeatRef.current = currentHeatKey;
  }
  if (isCurrentHeatLocked) hasBeenLockedRef.current = true;
  const stableHeatLocked = hasBeenLockedRef.current;
  const floatingTimeLeft = React.useMemo(
    () => getRemainingTimerSeconds(timer, floatingTimerTick),
    [timer, floatingTimerTick, getRemainingTimerSeconds]
  );

  const judgeAssignmentStatus = React.useMemo(() => {
    const configuredJudgeIds = (config.judges || [])
      .map((judgeId) => (judgeId || '').trim().toUpperCase())
      .filter(Boolean);

    const safeJudgeNames = Object.fromEntries(
      Object.entries(config.judgeNames || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
    );

    const missingNames = configuredJudgeIds.filter((judgeId) => {
      const assignedName = (safeJudgeNames[judgeId] || '').trim();
      return !assignedName || assignedName.toUpperCase() === judgeId;
    });

    const missingIdentity = configuredJudgeIds.filter((judgeId) => {
      const identityId = resolveAssignedJudgeIdentity(judgeId);
      return !identityId;
    });

    return {
      configuredJudgeIds,
      missingNames,
      missingIdentity,
      isReady: configuredJudgeIds.length > 0 && missingNames.length === 0 && missingIdentity.length === 0,
    };
  }, [config.judgeNames, config.judges, resolveAssignedJudgeIdentity]);

  const judgeAssignmentErrorMessage = React.useMemo(() => {
    const parts: string[] = [];
    if (judgeAssignmentStatus.missingNames.length > 0) {
      parts.push(`noms manquants: ${judgeAssignmentStatus.missingNames.join(', ')}`);
    }
    if (judgeAssignmentStatus.missingIdentity.length > 0) {
      parts.push(`identités officielles manquantes: ${judgeAssignmentStatus.missingIdentity.join(', ')}`);
    }
    return parts.join(' | ');
  }, [judgeAssignmentStatus]);

  const eventAssignmentCoverage = React.useMemo(() => {
    if (assignmentCoverageRows.length > 0) {
      return assignmentCoverageRows.map((row) => {
        const heatAssignments = eventJudgeAssignments.filter((assignment) => ensureHeatId(assignment.heat_id) === ensureHeatId(row.heat_id));
        return {
          heatId: row.heat_id,
          division: row.division,
          round: row.round,
          heatNumber: row.heat_number,
          status: allEventHeatsMeta.find((heat) => heat.division === row.division && heat.round === row.round && heat.heat_number === row.heat_number)?.status || 'unknown',
          assignedCount: row.assigned_station_count,
          missingStations: row.missing_station_count > 0
            ? (config.judges || [])
                .map((station) => (station || '').trim().toUpperCase())
                .filter((station) => !heatAssignments.some((assignment) => (assignment.station || '').trim().toUpperCase() === station && (assignment.judge_id || '').trim() && (assignment.judge_name || '').trim()))
            : [],
          assignments: (config.judges || []).map((station) => {
            const assignment = heatAssignments.find((candidate) => (candidate.station || '').trim().toUpperCase() === (station || '').trim().toUpperCase());
            return {
              station,
              judgeId: assignment?.judge_id || '',
              judgeName: assignment?.judge_name || ''
            };
          })
        };
      });
    }

    const expectedStations = (config.judges || []).map((station) => (station || '').trim().toUpperCase()).filter(Boolean);
    if (!config.competition || expectedStations.length === 0 || allEventHeatsMeta.length === 0) {
      return [];
    }

    const assignmentsByHeat = eventJudgeAssignments.reduce<Map<string, Map<string, HeatJudgeAssignmentRow>>>((acc, assignment) => {
      const heatId = ensureHeatId(assignment.heat_id);
      const station = (assignment.station || '').trim().toUpperCase();
      if (!heatId || !station) return acc;
      if (!acc.has(heatId)) {
        acc.set(heatId, new Map());
      }
      acc.get(heatId)!.set(station, assignment);
      return acc;
    }, new Map());

    return allEventHeatsMeta
      .map((heat) => {
        const heatId = getHeatIdentifiers(
          config.competition,
          heat.division,
          heat.round,
          heat.heat_number
        ).normalized;
        const assignments = assignmentsByHeat.get(heatId) ?? new Map<string, HeatJudgeAssignmentRow>();
        const missingStations = expectedStations.filter((station) => {
          const assignment = assignments.get(station);
          return !assignment || !(assignment.judge_id || '').trim() || !(assignment.judge_name || '').trim();
        });

        return {
          heatId,
          division: heat.division,
          round: heat.round,
          heatNumber: heat.heat_number,
          status: heat.status,
          assignedCount: assignments.size,
          missingStations,
          assignments: expectedStations.map((station) => ({
            station,
            judgeId: assignments.get(station)?.judge_id || '',
            judgeName: assignments.get(station)?.judge_name || ''
          }))
        };
      })
      .sort((a, b) => {
        if (a.division !== b.division) {
          return a.division.localeCompare(b.division, undefined, { sensitivity: 'base' });
        }
        if (a.round !== b.round) return a.round - b.round;
        return a.heatNumber - b.heatNumber;
      });
  }, [allEventHeatsMeta, config.competition, config.judges, eventJudgeAssignments]);

  const eventAssignmentSummary = React.useMemo(() => {
    const totalHeats = eventAssignmentCoverage.length;
    const completeHeats = eventAssignmentCoverage.filter((heat) => heat.missingStations.length === 0).length;
    return {
      totalHeats,
      completeHeats,
      incompleteHeats: Math.max(totalHeats - completeHeats, 0),
    };
  }, [eventAssignmentCoverage]);

  useEffect(() => {
    if (!activeDivisionOptions.length) return;
    const currentIsValid = activeDivisionOptions.some(
      (division) => division.toLowerCase() === config.division.toLowerCase()
    );
    if (!currentIsValid) {
      onConfigChange({ ...config, division: activeDivisionOptions[0] });
    }
  }, [activeDivisionOptions, config, onConfigChange]);

  useEffect(() => {
    if (!visibleRoundOptions.length) return;

    const firstRound = visibleRoundOptions[0];
    const nextRound = visibleRoundOptions.includes(config.round) ? config.round : firstRound;

    const heatsInRound = divisionHeatSequence
      .filter((row) => row.round === nextRound)
      .map((row) => row.heat_number);
    const uniqueHeats = Array.from(new Set(heatsInRound))
      .sort((a, b) => a - b)
      .filter((heat) => showClosedHeats || !isHeatClosed(heat, nextRound));
    const firstHeat = uniqueHeats[0] ?? config.heatId;
    const nextHeatId = uniqueHeats.includes(config.heatId) && nextRound === config.round
      ? config.heatId
      : firstHeat;

    if (nextRound !== config.round || nextHeatId !== config.heatId) {
      onConfigChange({ ...config, round: nextRound, heatId: nextHeatId });
    }
  }, [visibleRoundOptions, divisionHeatSequence, config, onConfigChange, showClosedHeats, isHeatClosed]);

  const handleSaveOfflineAdminPin = () => {
    try {
      if (offlineAdminPin.trim()) {
        localStorage.setItem('admin_offline_pin', offlineAdminPin.trim());
      } else {
        localStorage.removeItem('admin_offline_pin');
      }
      alert('Code admin hors-ligne enregistré.');
    } catch (error) {
      console.warn('Impossible de sauvegarder le code admin hors-ligne', error);
      alert('Erreur: impossible de sauvegarder le code admin hors-ligne.');
    }
  };




  const handleSaveConfig = async () => {
    if (!judgeAssignmentStatus.isReady) {
      alert(`Affectations juges incomplètes. ${judgeAssignmentErrorMessage}`);
      return;
    }

    // Ensure event exists in Supabase if competition is set
    if (config.competition && isSupabaseConfigured()) {
      try {
        // ensureEventExists is now imported statically
        const eventId = await ensureEventExists(config.competition);
        // Store event ID for future use
        localStorage.setItem('surfJudgingActiveEventId', String(eventId));
        console.log(`✅ Event ensured: ${config.competition} (ID: ${eventId})`);
      } catch (error) {
        console.warn('⚠️ Could not ensure event exists:', error);
        // Continue anyway - event creation is optional
      }
    }

    onConfigSaved(true);
    // Sauvegarder immédiatement dans localStorage
    localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
    localStorage.setItem('surfJudgingConfigSaved', 'true');
  };

  const handleTimerStart = () => {
    if (!judgeAssignmentStatus.isReady) {
      setSyncError(`Affectations juges incomplètes: ${judgeAssignmentErrorMessage}`);
      return;
    }

    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date(),
      duration: timer.duration
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    setSyncError(null);

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerStart && configSaved) {
      onRealtimeTimerStart(heatId, config, newTimer.duration)
        .then(() => {
          console.log('🚀 ADMIN: Timer START publié en temps réel');
        })
        .catch((error) => {
          console.error('⚠️ ADMIN: Timer START failed:', error);
          setSyncError("Échec de synchronisation (START). Les tablettes ne sont peut-être pas synchronisées.");
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }

    console.log('▶️ ADMIN: Timer démarré:', newTimer);
  };

  const handleTimerResume = () => {
    if (timer.isRunning) return;
    handleTimerStart();
  };

  const handleTimerStartImpl = async () => {
    if (!configSaved || isCurrentHeatLocked) return;
    if (!judgeAssignmentStatus.isReady) {
      setSyncError(`Affectations juges incomplètes: ${judgeAssignmentErrorMessage}`);
      return;
    }
    setIsTimerOpen(false);
    timerAudio.playStartHorn();
    const fullDuration = Math.max(1, plannedTimerDuration || timer.duration || 20);
    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date(),
      duration: fullDuration
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    setSyncError(null);

    if (onRealtimeTimerStart) {
      onRealtimeTimerStart(heatId, config, fullDuration)
        .then(() => {
          console.log('🔁 ADMIN: Timer RESTART publié en temps réel');
        })
        .catch((error) => {
          console.error('⚠️ ADMIN: Timer RESTART failed:', error);
          setSyncError("Échec de synchronisation (RESTART).");
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }
  };

  const handleTimerRestartFull = () => {
    if (!configSaved) return;
    if (!judgeAssignmentStatus.isReady) {
      setSyncError(`Affectations juges incomplètes: ${judgeAssignmentErrorMessage}`);
      return;
    }
    const fullDuration = Math.max(1, plannedTimerDuration || timer.duration || 20);
    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date(),
      duration: fullDuration
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    setSyncError(null);

    if (onRealtimeTimerStart) {
      onRealtimeTimerStart(heatId, config, fullDuration)
        .then(() => {
          console.log('🔁 ADMIN: Timer RESTART publié en temps réel');
        })
        .catch((error) => {
          console.error('⚠️ ADMIN: Timer RESTART failed:', error);
          setSyncError("Échec de synchronisation (RESTART).");
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }
  };

  const handleTimerPause = () => {
    const elapsedMinutes = timer.startTime
      ? (Date.now() - new Date(timer.startTime).getTime()) / 1000 / 60
      : 0;
    const remainingDuration = Math.max(0, timer.duration - elapsedMinutes);

    const newTimer = {
      ...timer,
      isRunning: false,
      startTime: null,
      duration: remainingDuration
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    setSyncError(null);

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerPause && configSaved) {
      onRealtimeTimerPause(heatId, remainingDuration)
        .then(() => {
          console.log('⏸️ ADMIN: Timer PAUSE publié en temps réel');
        })
        .catch((error) => {
          console.error('⚠️ ADMIN: Timer PAUSE failed:', error);
          setSyncError("⚠️ ERREUR SYNC CLOUD : Le timer s'est arrêté ici mais peut-être pas sur les tablettes ! Vérifiez la connexion.");
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }

    console.log('⏸️ ADMIN: Timer pausé:', newTimer);
  };

  const handleTimerReset = () => {
    const newTimer = {
      ...timer,
      isRunning: false,
      startTime: null
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    setSyncError(null);

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerReset && configSaved) {
      onRealtimeTimerReset(heatId, newTimer.duration)
        .then(() => {
          console.log('🔄 ADMIN: Timer RESET publié en temps réel');
        })
        .catch((error) => {
          console.error('⚠️ ADMIN: Timer RESET failed:', error);
          setSyncError("Échec de synchronisation (RESET).");
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }

    console.log('🔄 ADMIN: Timer reset:', newTimer);
  };

  const handleTimerDurationChange = (duration: number) => {
    const newTimer = {
      ...timer,
      duration
    };
    setPlannedTimerDuration(duration);
    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
  };

  const canCloseHeat = () => {
    const normalizeJudgeId = (raw?: string) => {
      const upper = (raw || '').trim().toUpperCase();
      if (upper === 'KIOSK-J1') return 'J1';
      if (upper === 'KIOSK-J2') return 'J2';
      if (upper === 'KIOSK-J3') return 'J3';
      return upper;
    };

    const normalizeText = (value?: string) => (value || '').trim().toUpperCase();

    const exactHeatScores = (mergedScores || []).filter(
      (score) => ensureHeatId(score.heat_id) === heatId && Number(score.score) > 0
    );

    const fallbackByMetaScores = (mergedScores || []).filter((score) => {
      if (Number(score.score) <= 0) return false;
      const sameCompetition = normalizeText(score.competition) === normalizeText(config.competition);
      const sameDivision = normalizeText(score.division) === normalizeText(config.division);
      const sameRound = Number(score.round) === Number(config.round);
      return sameCompetition && sameDivision && sameRound;
    });

    const currentHeatScores = exactHeatScores.length > 0 ? exactHeatScores : fallbackByMetaScores;
    if (!currentHeatScores.length) return false;

    const configuredJudges = new Set(
      (config.judges || [])
        .map((judgeId) => normalizeJudgeId(judgeId))
        .filter(Boolean)
    );
    const scoredJudges = new Set(
      currentHeatScores
        .map((score) => normalizeJudgeId(score.judge_id))
        .filter(Boolean)
    );

    // Prefer configured judges when available; fallback to observed judges.
    const judgeCount = configuredJudges.size > 0 ? configuredJudges.size : scoredJudges.size;
    if (judgeCount === 0) return false;

    // Group scores by surfer and wave (current heat only)
    const waveScores = new Map<string, Set<string>>();

    currentHeatScores.forEach(score => {
      const key = `${score.surfer}-W${score.wave_number}`;
      if (!waveScores.has(key)) {
        waveScores.set(key, new Set());
      }
      waveScores.get(key)!.add(normalizeJudgeId(score.judge_id));
    });

    // If at least one positive score exists for the current heat,
    // allow closing without warning (prevents false negatives on synced/offline rows).
    if (currentHeatScores.length > 0) {
      return true;
    }

    // Legacy fallback (kept for debugging visibility)
    const effectiveMinJudges = judgeCount >= 3 ? Math.ceil(judgeCount / 2) : Math.max(1, judgeCount);

    for (const [waveKey, judges] of waveScores.entries()) {
      if (judges.size >= effectiveMinJudges) {
        console.log(`✅ Vague complète trouvée: ${waveKey} (${judges.size}/${judgeCount} juges)`);
        return true;
      }
    }

    // Fallback: if enough distinct judges have scored this heat, avoid false warning
    // caused by inconsistent wave numbering in legacy synced rows.
    if (scoredJudges.size >= effectiveMinJudges && currentHeatScores.length >= effectiveMinJudges) {
      console.log(`✅ Fallback close validation: ${scoredJudges.size} juges actifs sur ce heat`);
      return true;
    }

    console.warn(`⚠️ Pas assez de juges sur une même vague (Requis: ${effectiveMinJudges}). Détail:`, Object.fromEntries(waveScores));
    return false;
  };

  const getFallbackColorForPosition = (position: number): string | null => {
    switch (position) {
      case 1:
        return 'RED';
      case 2:
        return 'WHITE';
      case 3:
        return 'YELLOW';
      case 4:
        return 'BLUE';
      case 5:
        return 'GREEN';
      case 6:
        return 'BLACK';
      default:
        return null;
    }
  };

  const handleRebuildDivisionQualifiers = async () => {
    if (!config.competition || !config.division) {
      setOverrideStatus({ type: 'error', message: 'Compétition/division manquante.' });
      return;
    }

    setRebuildPending(true);
    try {
      const eventId = await fetchEventIdByName(config.competition);
      if (!eventId) {
        throw new Error('Événement introuvable.');
      }

      const sequence = await fetchOrderedHeatSequence(eventId, config.division);
      if (!sequence.length) {
        throw new Error(`Aucun heat trouvé pour la division ${config.division}.`);
      }

      const parseSourceFromPlaceholder = (placeholder?: string | null) => {
        const normalized = (placeholder || '').toUpperCase().trim();
        if (!normalized) return null;

        const direct = normalized.match(/R(P?)(\d+)-H(\d+)-P(\d+)/);
        if (direct) return { round: Number(direct[2]), heat: Number(direct[3]), position: Number(direct[4]) };

        const displayStyle = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)\s*\(P\s*(\d+)\)/);
        if (displayStyle) return { round: Number(displayStyle[1]), heat: Number(displayStyle[2]), position: Number(displayStyle[3]) };

        const loose = normalized.match(/R\s*(\d+)\s*[- ]\s*H\s*(\d+)\s*[- ]?\s*P\s*(\d+)/);
        if (loose) return { round: Number(loose[1]), heat: Number(loose[2]), position: Number(loose[3]) };

        return null;
      };

      const rankCache = new Map<string, Map<number, { participantId: number | null; seed: number | null; colorCode: string | null }>>();
      let updatedTargetHeats = 0;

      for (const targetHeat of sequence) {
        const mappings = await fetchHeatSlotMappings(targetHeat.id);
        if (!mappings.length) continue;

        const targetEntries = await fetchHeatEntriesWithParticipants(targetHeat.id);
        const targetSeedByPosition = new Map<number, number>();
        targetEntries.forEach((entry) => {
          targetSeedByPosition.set(entry.position, entry.seed ?? entry.position);
        });

        const targetColorOrder = (targetHeat.color_order ?? []).map((color) => (color || '').toUpperCase());
        const updates: Array<{ position: number; participant_id: number | null; seed?: number | null; color?: string | null }> = [];

        for (const mapping of mappings as any[]) {
          const parsedFromPlaceholder = parseSourceFromPlaceholder(mapping.placeholder);
          const parsed = parsedFromPlaceholder ?? (
            (mapping.source_round != null && mapping.source_heat != null && mapping.source_position != null)
              ? {
                round: Number(mapping.source_round),
                heat: Number(mapping.source_heat),
                position: Number(mapping.source_position),
              }
              : null
          );

          if (!parsed || !parsed.round || !parsed.heat || !parsed.position) continue;

          const sourceHeat = sequence.find((item) => Number(item.round) === parsed.round && Number(item.heat_number) === parsed.heat);
          if (!sourceHeat) continue;

          if (!rankCache.has(sourceHeat.id)) {
            const sourceScoresRaw = await fetchHeatScores(sourceHeat.id);
            const sourceScores = sourceScoresRaw
              .filter((score) => Number(score.score) > 0)
              .map((score) => ({ ...score, surfer: normalizeJerseyLabel(score.surfer) || score.surfer }));

            const sourceEntries = await fetchHeatEntriesWithParticipants(sourceHeat.id);
            const entryByColor = new Map<string, { participantId: number | null; seed: number | null; colorCode: string | null }>();

            sourceEntries.forEach((entry) => {
              const rawColor = (entry.color || '').toUpperCase();
              const label = normalizeJerseyLabel(rawColor);
              if (!label) return;
              entryByColor.set(label, {
                participantId: entry.participant_id ?? null,
                seed: entry.seed ?? null,
                colorCode: rawColor || null,
              });
            });

            const entryByRank = new Map<number, { participantId: number | null; seed: number | null; colorCode: string | null }>();
            if (sourceScores.length > 0 && entryByColor.size > 0) {
              const surfers = Array.from(entryByColor.keys());
              const judgeCount = Math.max(new Set(sourceScores.map((score) => score.judge_id).filter(Boolean)).size, 1);
              const maxWaves = Math.max(config.waves || 12, 1);
              const sourceInterferenceCalls = await fetchInterferenceCalls(sourceHeat.id);
              const effectiveInterferences = computeEffectiveInterferences(sourceInterferenceCalls, judgeCount);
              const stats = calculateSurferStats(sourceScores, surfers, judgeCount, maxWaves, true, effectiveInterferences)
                .sort((a, b) => a.rank - b.rank);

              stats.forEach((stat) => {
                const info = entryByColor.get(stat.surfer.trim().toUpperCase());
                if (info) {
                  entryByRank.set(stat.rank, info);
                }
              });
            }

            rankCache.set(sourceHeat.id, entryByRank);
          }

          const entryByRank = rankCache.get(sourceHeat.id) ?? new Map();
          const qualifier = entryByRank.get(parsed.position);
          const mappedColor = targetColorOrder[mapping.position - 1] || getFallbackColorForPosition(mapping.position);

          // Important: if source heat has no valid result for this slot, explicitly clear stale participant.
          updates.push({
            position: mapping.position,
            participant_id: qualifier?.participantId ?? null,
            seed: qualifier?.seed ?? targetSeedByPosition.get(mapping.position) ?? mapping.position,
            color: mappedColor,
          });
        }

        if (updates.length) {
          await replaceHeatEntries(targetHeat.id, updates);
          updatedTargetHeats += 1;
        }
      }

      setOverrideStatus({
        type: 'success',
        message: `Qualifiés recalculés pour ${config.division}. Heats cibles mis à jour: ${updatedTargetHeats}.`
      });
      onReloadData();
    } catch (error) {
      console.error('❌ Rebuild qualifiers error:', error);
      const message = error instanceof Error ? error.message : 'Impossible de recalculer les qualifiés.';
      setOverrideStatus({ type: 'error', message });
    } finally {
      setRebuildPending(false);
    }
  };

  const handleCloseHeat = async () => {
    // --- Check for pending scores FIRST ---
    // Compute expected: for each surfer, find the max wave any judge scored.
    // Then verify every configured judge has scored every surfer up to that wave.
    const heatScoresForCheck = (mergedScores || []).filter(
      s => ensureHeatId(s.heat_id) === heatId && Number(s.score) > 0
    );

    // Build configured judge IDs (resolved from station names)
    const safeIdent = Object.fromEntries(
      Object.entries(config.judgeIdentities || {}).map(([k, v]) => [k.trim().toUpperCase(), v])
    );
    const configuredJudgeIds = (config.judges || []).map(
      station => (safeIdent[station.trim().toUpperCase()] || station).trim()
    ).filter(Boolean);

    // Find pending: judge × surfer × wave combos that are missing
    const pending: string[] = [];
    if (configuredJudgeIds.length > 0 && heatScoresForCheck.length > 0) {
      // For each surfer, find the max wave number scored by any judge
      const surferMaxWave = new Map<string, number>();
      heatScoresForCheck.forEach(s => {
        const surfer = normalizeJerseyLabel(s.surfer);
        surferMaxWave.set(surfer, Math.max(surferMaxWave.get(surfer) || 0, s.wave_number));
      });

      configuredJudgeIds.forEach(judgeId => {
        surferMaxWave.forEach((maxWave, surfer) => {
          for (let w = 1; w <= maxWave; w++) {
            const hasScore = heatScoresForCheck.some(
              s => normalizeJerseyLabel(s.surfer) === surfer &&
                   s.wave_number === w &&
                   (s.judge_id === judgeId || s.judge_station === judgeId)
            );
            if (!hasScore) {
              // Case-insensitive Reverse-lookup: UUID → station (from judgeIdentities), then station → display name
              const upperJudgeId = judgeId?.trim().toUpperCase();
              const stationForJudge = Object.entries(config.judgeIdentities || {})
                .find(([, uuid]) => uuid?.trim().toUpperCase() === upperJudgeId)?.[0] || judgeId;
              
              const judgeName = (
                config.judgeNames?.[stationForJudge] || 
                config.judgeNames?.[judgeId] || 
                (availableOfficialJudges.find(j => j.id?.trim().toUpperCase() === upperJudgeId)?.name) ||
                stationForJudge
              ).trim();
              pending.push(`${judgeName} → ${surfer} V${w}`);
            }
          }
        });
      });
    }

    if (pending.length > 0) {
      const missingList = pending.slice(0, 10).join('\n  \u2022 ');
      const forceClose = confirm(
        `\u26a0\ufe0f NOTES MANQUANTES \u2014 ${pending.length} note(s) non saisie(s) :\n\n  \u2022 ${missingList}` +
        (pending.length > 10 ? `\n  \u2022 ... et ${pending.length - 10} autre(s)` : '') +
        '\n\nFermer quand m\u00eame ce heat ?'
      );
      if (!forceClose) return;
    }

    let canCloseWithoutWarning = canCloseHeat();

    // Safety net: if local/store state is stale, verify directly from DB before showing warning.
    if (!canCloseWithoutWarning) {
      try {
        const dbScores = await fetchHeatScores(heatId);
        if (dbScores.some((score) => Number(score.score) > 0)) {
          canCloseWithoutWarning = true;
        }
      } catch (error) {
        console.warn('Impossible de vérifier les scores DB avant fermeture du heat:', error);
      }
    }

    // Warning if no scores at all, but allow to proceed with confirmation
    if (!canCloseWithoutWarning) {
      const forceClose = confirm(
        '⚠️ ATTENTION: Aucune note enregistrée pour ce heat!\n\n' +
        'Ce heat sera fermé SANS RÉSULTATS.\n' +
        'Voulez-vous quand même fermer ce heat?'
      );
      if (!forceClose) {
        return;
      }
    } else if (pending.length === 0) {
      // Normal confirmation (only if no pending warning was already shown)
      if (!confirm(`✅ Toutes les notes sont complètes.

Fermer le Heat ${config.heatId} et passer au suivant ?`)) {
        return;
      }
    }

    // Failsafe validation
    try {
      let eventId: number | null = null;
      // Try to find event ID from config or name
      if (config.competition) {
        eventId = await fetchEventIdByName(config.competition);
      }

      if (eventId) {
        // Optional external workflow hook (disabled by default to avoid cross-division side effects).
        const enableExternalHeatSync = import.meta.env.VITE_ENABLE_HEAT_SYNC_WEBHOOK === 'true';
        if (enableExternalHeatSync) {
          try {
            const currentHeatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
            console.log('🔄 Calling heat-sync for:', currentHeatId);

            if (!supabase) throw new Error("Supabase client not initialized");

            const { data: syncData, error: syncError } = await supabase.functions.invoke('heat-sync', {
              body: {
                heat_id: currentHeatId,
                event_id: eventId,
                action: 'finalize'
              }
            });

            if (syncError) {
              console.warn('⚠️ Heat sync failed, continuing anyway:', syncError);
            } else {
              console.log('✅ Heat sync successful:', syncData);
            }
          } catch (syncErr) {
            console.warn('⚠️ Heat sync error, continuing anyway:', syncErr);
          }
        }

        const sequence = await fetchOrderedHeatSequence(eventId, config.division);

        // Check if it was the last heat AFTER syncing
        if (sequence && sequence.length > 0) {
          const currentIndex = sequence.findIndex(h =>
            h.round === config.round && h.heat_number === config.heatId
          );

          if (currentIndex !== -1 && currentIndex === sequence.length - 1) {
            alert('🏁 Fin de l\'événement (ou de la division) ! Tous les heats ont été notés.');
            // We still proceed to onCloseHeat to update UI state
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Validation failsafe error:', err);
      // Continue anyway if validation fails (fallback)
    }

    // Vérifier les juges qui travaillent beaucoup
    const overworkedJudges = Object.entries(judgeWorkCount)
      .filter(([, count]) => count >= 4)
      .map(([judgeId, count]) => `${config.judgeNames[judgeId] || judgeId} (${count + 1} heats)`);

    if (overworkedJudges.length > 0) {
      const message = `⚠️ ATTENTION: Ces juges vont faire leur 5ème heat consécutif ou plus:\n\n${overworkedJudges.join('\n')}\n\nConsidérez une rotation des juges pour éviter la fatigue.`;
      alert(message);
    }

    onCloseHeat();
  };

  const surferScoredWaves = React.useMemo(() => {
    if (!selectedSurfer) return [];
    const selectedSurferKey = normalizeJerseyLabel(selectedSurfer);
    // Match scores by heatId, with a metadata fallback for rows that may lack heat_id
    const waves = new Set(mergedScores
      .filter(s => {
        if (normalizeJerseyLabel(s.surfer) !== selectedSurferKey) return false;
        if (Number(s.score) <= 0) return false;
        // Primary: exact heat_id match
        if (ensureHeatId(s.heat_id) === heatId) return true;
        // Fallback: match by competition+division+round meta (for offline/synced scores)
        const sameComp = (s.competition || '').trim().toUpperCase() === (config.competition || '').trim().toUpperCase();
        const sameDiv = (s.division || '').trim().toUpperCase() === (config.division || '').trim().toUpperCase();
        const sameRound = Number(s.round) === Number(config.round);
        return sameComp && sameDiv && sameRound;
      })
      .map(s => s.wave_number)
    );
    return Array.from(waves).sort((a, b) => a - b);
  }, [mergedScores, selectedSurfer, heatId, config.competition, config.division, config.round, config.heatId]);

  React.useEffect(() => {
    if (!selectedWave) return;
    if (!surferScoredWaves.includes(Number(selectedWave))) {
      setSelectedWave('');
    }
  }, [selectedWave, surferScoredWaves]);

  const handleResetAllData = () => {
    console.log('🗑️ RESET COMPLET DEPUIS ADMIN...');
    onResetAllData();
  };

  const handleAddJudge = () => {
    const nextJudgeNumber = config.judges.length + 1;
    const nextJudgeId = `J${nextJudgeNumber}`;
    if (config.judges.includes(nextJudgeId)) return;
    onConfigChange({
      ...config,
      judges: [...config.judges, nextJudgeId],
      judgeNames: {
        ...config.judgeNames,
        [nextJudgeId]: nextJudgeId
      },
      judgeIdentities: {
        ...(config.judgeIdentities || {})
      },
    });
  };

  const handleRemoveJudge = (judgeId: string) => {
    const nextJudgeNames = { ...config.judgeNames };
    const nextJudgeEmails = { ...(config.judgeEmails || {}) };
    const nextJudgeIdentities = { ...(config.judgeIdentities || {}) };
    delete nextJudgeNames[judgeId];
    delete nextJudgeEmails[judgeId];
    delete nextJudgeIdentities[judgeId];

    onConfigChange({
      ...config,
      judges: config.judges.filter((id) => id !== judgeId),
      judgeNames: nextJudgeNames,
      judgeEmails: nextJudgeEmails,
      judgeIdentities: nextJudgeIdentities
    });
  };

  const handleJudgeIdentityChange = (stationId: string, identityId: string) => {
    const nextJudgeIdentities = { ...(config.judgeIdentities || {}) };
    const trimmedIdentityId = identityId.trim();

    if (!trimmedIdentityId) {
      delete nextJudgeIdentities[stationId];
      onConfigChange({
        ...config,
        judgeIdentities: nextJudgeIdentities
      });
      return;
    }

    const officialJudge = availableOfficialJudges.find((judge) => judge.id === trimmedIdentityId);
    nextJudgeIdentities[stationId] = trimmedIdentityId;

    onConfigChange({
      ...config,
      judgeIdentities: nextJudgeIdentities,
      judgeNames: {
        ...config.judgeNames,
        [stationId]: officialJudge?.name || config.judgeNames?.[stationId] || stationId
      },
      judgeEmails: {
        ...(config.judgeEmails || {}),
        [stationId]: officialJudge?.email || config.judgeEmails?.[stationId] || ''
      }
    });
  };

  const handleJudgeNameChange = (judgeId: string, name: string) => {
    onConfigChange({
      ...config,
      judgeNames: {
        ...config.judgeNames,
        [judgeId]: name
      }
    });
  };

  const handleJudgeEmailChange = (judgeId: string, email: string) => {
    onConfigChange({
      ...config,
      judgeEmails: {
        ...(config.judgeEmails || {}),
        [judgeId]: email
      }
    });
  };

  const handleCreateOfficialJudge = async (stationId: string) => {
    const judgeName = (config.judgeNames?.[stationId] || '').trim();
    const judgeEmail = (config.judgeEmails?.[stationId] || '').trim();

    if (!judgeName) {
      setOfficialJudgeStatus({
        type: 'error',
        message: `Renseigne d'abord un nom pour ${stationId}.`
      });
      return;
    }

    const existingJudge = availableOfficialJudges.find((judge) => {
      const sameName = (judge.name || '').trim().toLowerCase() === judgeName.toLowerCase();
      const sameEmail = judgeEmail && (judge.email || '').trim().toLowerCase() === judgeEmail.toLowerCase();
      return sameName || Boolean(sameEmail);
    });

    const attachJudgeToStation = (judge: Judge, generatedCode?: string) => {
      onConfigChange({
        ...config,
        judgeIdentities: {
          ...(config.judgeIdentities || {}),
          [stationId]: judge.id
        },
        judgeNames: {
          ...config.judgeNames,
          [stationId]: judge.name || judgeName
        },
        judgeEmails: {
          ...(config.judgeEmails || {}),
          [stationId]: judge.email || judgeEmail
        }
      });

      setOfficialJudgeStatus({
        type: 'success',
        message: generatedCode
          ? `${judge.name} a ete cree comme officiel. Code personnel: ${generatedCode}`
          : `${judge.name} est maintenant lie a ${stationId}.`
      });
    };

    if (existingJudge) {
      attachJudgeToStation(existingJudge);
      return;
    }

    setCreatingOfficialJudgeFor(stationId);
    setOfficialJudgeStatus(null);

    try {
      const personalCode = generateJudgePersonalCode();
      const createdJudge = await createJudge({
        name: judgeName,
        email: judgeEmail || undefined,
        personal_code: personalCode,
      });

      const refreshedJudges = await loadOfficialJudges();
      const resolvedJudge = refreshedJudges.find((judge) => judge.id === createdJudge.id) || createdJudge;
      attachJudgeToStation(resolvedJudge, personalCode);
    } catch (error) {
      console.error('Impossible de creer le juge officiel:', error);
      setOfficialJudgeStatus({
        type: 'error',
        message: `Creation du juge officiel impossible pour ${judgeName}.`
      });
    } finally {
      setCreatingOfficialJudgeFor(null);
    }
  };

  const handleSurferNameChange = (color: string, name: string) => {
    onConfigChange({
      ...config,
      surferNames: {
        ...(config.surferNames || {}),
        [color]: name
      }
    });
  };

  const handleSurferCountryChange = (color: string, country: string) => {
    onConfigChange({
      ...config,
      surferCountries: {
        ...(config.surferCountries || {}),
        [color]: country
      }
    });
  };



  const exportData = () => {
    const data = {
      config,
      timer,
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surf-judging-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportEventPdf = async () => {
    if (!isSupabaseConfigured()) {
      alert('Supabase n\'est pas configuré pour exporter l\'événement.');
      return;
    }
    const eventIdFromUrl = (() => {
      if (typeof window === 'undefined') return NaN;
      const raw = new URLSearchParams(window.location.search).get('eventId');
      return raw ? Number(raw) : NaN;
    })();
    const eventIdRaw = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY) : null;
    const eventId =
      activeEventId
      ?? (Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0 ? eventIdFromUrl : null)
      ?? (eventIdRaw ? Number(eventIdRaw) : NaN);
    if (!eventId || Number.isNaN(eventId)) {
      alert('Aucun événement actif trouvé. Chargez un événement avant export.');
      return;
    }

    setEventPdfPending(true);
    try {
      // Fetch ALL categories and ALL heats for the event
      const allDivisions = await fetchAllEventHeats(eventId);

      if (!Object.keys(allDivisions).length) {
        alert('Aucune structure de heats trouvée pour cet événement.');
        return;
      }

      // Fetch ALL scores for ALL heats
      const allScores = await fetchPreferredScoresForEvent(eventId);
      const allInterferenceCalls = await fetchAllInterferenceCallsForEvent(eventId);

      // Get event details (organizer, date, optional logo) if available
      let organizer: string | undefined;
      let eventDate: string | undefined;
      let organizerLogoDataUrl: string | undefined;
      let resolvedEventName = config.competition || 'Compétition';

      if (supabase) {
        const { data: dbEventData } = await supabase
          .from('events')
          .select('*')
          .eq('id', eventId)
          .single();

        const localEventData = JSON.parse(localStorage.getItem('eventData') || '{}');
        const eventData = { ...localEventData, ...(dbEventData || {}) };

        if (dbEventData || localEventData.id) {
          if (typeof eventData.name === 'string' && eventData.name.trim()) {
            resolvedEventName = eventData.name.trim();
          }
          organizer = eventData.organizer ?? undefined;
          eventDate = eventData.start_date
            ? new Date(eventData.start_date).toLocaleDateString('fr-FR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
            : undefined;

          const logoCandidate = (
            eventData.organizerLogoDataUrl ||
            eventData.logo_url ||
            eventData.logo ||
            eventData.organizer_logo_url ||
            eventData.image_url ||
            eventData.brand_logo_url ||
            eventData?.config?.organizerLogoDataUrl
          ) as string | undefined;

          if (logoCandidate && logoCandidate.startsWith('data:image/')) {
            organizerLogoDataUrl = logoCandidate;
          } else if (logoCandidate && /^https?:\/\//i.test(logoCandidate)) {
            try {
              const response = await fetch(logoCandidate);
              if (response.ok) {
                const blob = await response.blob();
                organizerLogoDataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(String(reader.result || ''));
                  reader.onerror = () => reject(new Error('Impossible de lire le logo.'));
                  reader.readAsDataURL(blob);
                });
              }
            } catch (error) {
              console.warn('Logo organisateur non chargé pour le PDF:', error);
            }
          }
        }
      }

      // Export complete competition PDF
      exportFullCompetitionPDF({
        eventName: resolvedEventName,
        organizer,
        organizerLogoDataUrl,
        date: eventDate,
        divisions: allDivisions,
        scores: allScores,
        interferenceCalls: allInterferenceCalls,
        configuredJudgeCount: config.judges.length,
      });

      console.log('✅ PDF complet généré avec', Object.keys(allDivisions).length, 'catégories');
    } catch (error) {
      console.error('Impossible de générer le PDF complet', error);
      alert('Impossible de générer le PDF complet pour le moment.');
    } finally {
      setEventPdfPending(false);
    }
  };

  const handleExportPdf = () => {
    try {
      exportHeatScorecardPdf({ config, scores });
    } catch (error) {
      console.error('Impossible de générer le PDF du heat:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Statut de la base de données & Contexte - Collapsible */}
      <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden" open>
        <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
          <div className="flex items-center space-x-3">
            <Database className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">1. CONTEXTE ÉVÉNEMENT & BDD</h2>
          </div>
          <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-4 bg-white border-t-4 border-primary-950 flex flex-col space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              <Database className={`w-5 h-5 ${isSupabaseConfigured() ? 'text-success-600' : 'text-primary-300'}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary-400">
                Database: <span className={isSupabaseConfigured() ? 'text-success-600' : 'text-primary-600'}>
                  {isSupabaseConfigured() ? 'CONNECTED' : 'LOCAL ONLY'}
                </span>
              </span>
            </div>
          </div>

          <div className="mt-4 mb-6 p-4 rounded-lg border border-gray-200 bg-gray-50 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Contexte événement</h3>
              <span className="text-xs text-gray-500">
                event_id: {activeEventId ?? 'N/A'} · {loadedFromDb ? 'chargé depuis DB' : 'local only'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Événement</label>
                <input
                  type="text"
                  value={config.competition}
                  onChange={(e) => handleConfigChange('competition', e.target.value)}
                  placeholder="Nom de l'événement"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Division</label>
                <select
                  value={config.division}
                  onChange={(e) => handleConfigChange('division', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {activeDivisionOptions.map((division) => {
                    const closed = isCategoryClosed(division);
                    return (
                      <option key={division} value={division} disabled={!showClosedHeats && closed} className={!showClosedHeats && closed ? "text-gray-300 bg-gray-50" : ""}>
                        {division} {!showClosedHeats && closed ? '(Terminé)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="md:col-span-2 pt-2 border-t border-gray-100">
                <label className="block text-xs font-medium text-gray-600 mb-2">Logo de l'organisateur</label>
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0 h-16 w-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden">
                    {(() => {
                      const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
                      const logo = eventData.organizerLogoDataUrl || eventData.image_url || eventData.brand_logo_url;
                      return logo ? (
                        <img src={logo} alt="Logo" className="h-full w-full object-contain" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-gray-300" />
                      );
                    })()}
                  </div>
                  <div className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const base64 = ev.target?.result as string;
                          const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
                          eventData.organizerLogoDataUrl = base64;
                          localStorage.setItem('eventData', JSON.stringify(eventData));
                          // Force a re-render or notification if needed
                          window.dispatchEvent(new Event('storage'));
                        };
                        reader.readAsDataURL(file);
                      }}
                      className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">PNG/JPG recommandé. Apparaîtra sur les exports PDF.</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Round</label>
                <select
                  value={config.round}
                  onChange={(e) => handleConfigChange('round', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {visibleRoundOptions.map((round) => {
                    const closed = isRoundClosed(round);
                    return (
                      <option key={round} value={round} disabled={!showClosedHeats && closed} className={!showClosedHeats && closed ? "text-gray-300 bg-gray-50" : ""}>
                        Round {round} {!showClosedHeats && closed ? '(Terminé)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Heat</label>
                <select
                  value={config.heatId}
                  onChange={(e) => handleConfigChange('heatId', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {visibleHeatOptions.map((heat) => {
                    const closed = isHeatClosed(heat, config.round);
                    return (
                      <option key={heat} value={heat} disabled={!showClosedHeats && closed} className={!showClosedHeats && closed ? "text-gray-300 bg-gray-50" : ""}>
                        Heat {heat} {!showClosedHeats && closed ? '(Terminé)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              
              <div className="md:col-span-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                <label className="flex items-center space-x-2 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showClosedHeats}
                    onChange={(e) => setShowClosedHeats(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span>Afficher les séries terminées (Clôturées)</span>
                </label>
                <div className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded">
                  Status Actuel : <strong className="uppercase">{currentHeatStatus}</strong>
                </div>
              </div>
            </div>

            {!loadedFromDb && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs text-amber-900 mb-2">
                  Configuration non liée à la base. Recharge depuis Supabase pour récupérer l’événement actif.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleAutoReconnect}
                    disabled={reconnectPending || !onReconnectToDb}
                    className="px-3 py-1.5 text-xs font-medium bg-amber-200 rounded hover:bg-amber-300 disabled:opacity-50"
                  >
                    {reconnectPending ? 'Reconnexion...' : 'Reconnecter Supabase'}
                  </button>
                  <button
                    onClick={() => navigate('/my-events')}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-amber-300 rounded hover:bg-amber-100"
                  >
                    Mes événements
                  </button>
                </div>
                {reconnectMessage && <p className="text-xs mt-2 text-amber-900">{reconnectMessage}</p>}
              </div>
            )}
          </div>
        </div>
      </details>

      {/* Configuration Juges et Surfeurs - Collapsible (Fermé par défaut) */}
      <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden">
        <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
          <div className="flex items-center space-x-3">
            <Users className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">2. JUGES ET SURFEURS</h2>
          </div>
          <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-4 bg-white border-t-4 border-primary-950 flex flex-col space-y-6">

          {/* Nombre de Juges (Mode Kiosk) */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de Juges</label>
            <select
              value={config.judges.length}
              onChange={(e) => {
                const numJudges = parseInt(e.target.value);
                const judgeIds = Array.from({ length: numJudges }, (_, i) => `J${i + 1}`);
                const judgeNames = judgeIds.reduce((acc, id) => ({ ...acc, [id]: id }), {} as Record<string, string>);
                const judgeIdentities = judgeIds.reduce((acc, id) => {
                  const existingIdentity = config.judgeIdentities?.[id];
                  if (existingIdentity) {
                    acc[id] = existingIdentity;
                  }
                  return acc;
                }, {} as Record<string, string>);
                onConfigChange({
                  ...config,
                  judges: judgeIds,
                  judgeNames: judgeNames,
                  judgeIdentities
                });
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="3">3 Juges (J1, J2, J3)</option>
              <option value="4">4 Juges (J1, J2, J3, J4)</option>
              <option value="5">5 Juges (J1, J2, J3, J4, J5)</option>
            </select>
            <p className="mt-2 text-xs text-gray-500">
              Les juges utiliseront le mode kiosque avec leurs positions (J1, J2, etc.)
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Couverture des affectations officielles</h4>
                <p className="text-xs text-slate-600">
                  {eventAssignmentSummary.completeHeats}/{eventAssignmentSummary.totalHeats} heats complets
                  {eventAssignmentSummary.incompleteHeats > 0 ? ` · ${eventAssignmentSummary.incompleteHeats} à compléter` : ''}
                </p>
              </div>
              <div className={`text-xs font-semibold px-2 py-1 rounded-full ${eventAssignmentSummary.incompleteHeats > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {eventAssignmentSummary.incompleteHeats > 0 ? 'Vérification requise' : 'Complet'}
              </div>
            </div>

            {eventAssignmentCoverage.length === 0 ? (
              <p className="text-xs text-slate-500">Aucun heat détecté pour cet événement.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {eventAssignmentCoverage.map((heat) => (
                  <div key={heat.heatId} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-900">
                        {heat.division} · R{heat.round} H{heat.heatNumber}
                      </div>
                      <div className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${heat.missingStations.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {heat.missingStations.length > 0 ? `Manque: ${heat.missingStations.join(', ')}` : 'Complet'}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-600">
                      {heat.assignments
                        .filter((assignment) => assignment.judgeId)
                        .map((assignment) => `${assignment.station}: ${assignment.judgeName || assignment.judgeId}`)
                        .join(' · ') || 'Aucune affectation officielle enregistrée'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Surfeurs (lecture seule depuis Supabase) */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700">Surfeurs du heat</label>
            <div className="mt-1 mb-4 flex items-start space-x-2 text-sm text-gray-600">
              <InfoIcon className="w-4 h-4 text-gray-500 mt-0.5" />
              <p>
                Cette liste est synchronisée automatiquement à partir des heats planifiés dans la base.
                Modifiez les participants directement dans l’outil de planification si nécessaire.
              </p>
            </div>

            {config.surfers.length ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {config.surfers.map((surfer, index) => {
                  const surferKey = normalizeJerseyLabel(surfer);
                  const color = SURFER_COLOR_MAP[surferKey as keyof typeof SURFER_COLOR_MAP] ?? '#6b7280';
                  return (
                    <div key={`${surfer}-${index}`} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                      <div
                        className="w-4 h-4 rounded-full border border-gray-300"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium text-gray-900">{surfer}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                Aucun surfeur détecté pour ce heat. Vérifiez les entrées dans Supabase puis rechargez la configuration.
              </div>
            )}
          </div>

          <button
            onClick={handleSaveConfig}
            disabled={configSaved || loadState === 'loading' || !judgeAssignmentStatus.isReady}
            className={`w-full py-4 px-6 rounded-xl font-bebas text-2xl tracking-widest transition-all border-4 shadow-block flex justify-center items-center gap-2 ${configSaved
              ? 'bg-success-50 text-success-700 border-success-200 cursor-not-allowed opacity-80'
              : !judgeAssignmentStatus.isReady
                ? 'bg-amber-100 text-amber-800 border-amber-300 cursor-not-allowed opacity-90'
                : 'bg-cta-500 text-white border-primary-950 hover:-translate-y-1 hover:shadow-[4px_4px_0_0_#172554] active:translate-y-0 active:shadow-none'
              }`}
          >
            {configSaved ? (
              <>
                <CheckCircle className="w-6 h-6" /> CONFIGURATION SAUVEGARDÉE
              </>
            ) : !judgeAssignmentStatus.isReady ? (
              <>
                AFFECTATIONS JUGES INCOMPLÈTES
              </>
            ) : (
              <>
                SAUVEGARDER ET APPLIQUER
              </>
            )}
          </button>
          {!judgeAssignmentStatus.isReady && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Configuration incomplète: <span className="font-mono">{judgeAssignmentErrorMessage}</span>
            </div>
          )}
        </div>
      </details>

      {/* Timer */}
      <details 
        className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden" 
        open={isTimerOpen} 
        onToggle={(e) => setIsTimerOpen(e.currentTarget.open)}
      >
        <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
          <div className="flex items-center space-x-3">
            <Clock className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">3. CHRONOMÈTRE</h2>
          </div>
          <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-white border-t-4 border-primary-950 relative">
          {syncError && (
            <div className="w-full mb-4 p-2 bg-red-100 border border-red-300 rounded text-red-700 text-xs font-bold animate-pulse">
              {syncError}
            </div>
          )}
          {stableHeatLocked && (
            <div className="w-full mb-4 p-3 bg-orange-100 border border-orange-400 rounded-lg shadow-sm">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-orange-800 uppercase tracking-widest">Série Clôturée</h4>
                  <p className="text-xs text-orange-700 mt-1">
                    Ce heat a été définitivement fermé. La saisie de nouvelles notes et le chronomètre sont verrouillés sauf ré-ouverture exceptionnelle en base de données par l'administrateur système.
                  </p>
                </div>
              </div>
            </div>
          )}
          {!judgeAssignmentStatus.isReady && (
            <div className="w-full mb-4 p-3 bg-amber-100 border border-amber-400 rounded-lg shadow-sm">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-900 uppercase tracking-widest">Démarrage bloqué</h4>
                  <p className="text-xs text-amber-800 mt-1">
                    Le heat ne peut pas démarrer tant que ces postes n’ont pas une identité officielle complète: {judgeAssignmentErrorMessage}.
                  </p>
                </div>
              </div>
            </div>
          )}

          <HeatTimer
            key={`timer-${config.competition}-${config.division}-R${config.round}-H${config.heatId}`}
            timer={timer}
            onStart={handleTimerStartImpl}
            onPause={handleTimerPause}
            onReset={handleTimerReset}
            onDurationChange={handleTimerDurationChange}
            configSaved={configSaved}
            disabled={stableHeatLocked || !judgeAssignmentStatus.isReady}
          />
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleTimerResume}
              disabled={!configSaved || timer.isRunning || stableHeatLocked || !judgeAssignmentStatus.isReady}
              className="py-2 px-4 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Reprendre (temps restant)
            </button>
            <button
              type="button"
              onClick={handleTimerRestartFull}
              disabled={!configSaved || stableHeatLocked || !judgeAssignmentStatus.isReady}
              className="py-2 px-4 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Recommencer (durée complète)
            </button>
          </div>
        </div>
      </details>

      {/* Floating Timer Widget */}
      {(!isTimerOpen && timer.isRunning) && (
        <div className="fixed top-8 right-8 z-[100] bg-white border-4 border-primary-950 rounded-2xl shadow-2xl p-4 flex flex-col items-center pointer-events-auto transform transition-all">
          <div className="flex items-center space-x-2 w-full justify-between mb-2">
            <Clock className={`w-4 h-4 ${floatingTimeLeft <= 300 ? 'text-cta-500' : 'text-primary-600'}`} />
            <h3 className="text-xs font-bebas tracking-widest text-primary-800">CHRONO PRO</h3>
            <button onClick={() => setIsTimerOpen(true)} className="text-gray-400 hover:text-black">
              ▼
            </button>
          </div>
          <div className={`font-bebas tracking-wider text-5xl leading-none ${floatingTimeLeft <= 5 ? 'text-red-500 animate-pulse' : floatingTimeLeft <= 60 ? 'text-red-500' : floatingTimeLeft <= 300 ? 'text-cta-500' : 'text-primary-600'}`}>
            {formatMinSec(floatingTimeLeft)}
          </div>
          <button
            onClick={handleTimerPause}
            className="mt-3 w-full bg-cta-500 text-white rounded-lg border-2 border-primary-950 shadow-sm transition-all flex justify-center items-center py-1.5 font-bebas tracking-widest hover:-translate-y-0.5"
          >
            PAUSE
          </button>
        </div>
      )}

      <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden">
        <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
          <div className="flex items-center space-x-3">
            <Eye className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">4. AFFICHAGE PUBLIC</h2>
          </div>
          <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-white border-t-4 border-primary-950">
          <p className="text-sm text-gray-600 mb-4">
            Ouvrez ou partagez le tableau de scores en temps réel sur un autre écran.
          </p>
          {publicDisplayUrl ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleOpenDisplay}
                className="w-full py-2 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
              >
                Ouvrir l’affichage public
              </button>
              <button
                type="button"
                onClick={handleCopyDisplayLink}
                className="w-full py-2 px-4 rounded-lg border border-blue-200 text-blue-700 font-medium hover:bg-blue-50 transition-colors"
              >
                {displayLinkCopied ? 'Lien copié ✅' : 'Copier le lien'}
              </button>
              <div className="text-xs text-gray-500 break-all bg-gray-50 p-3 rounded border border-gray-200">
                {publicDisplayUrl}
              </div>
              <div className="border-t border-gray-200 pt-3">
                <p className="text-sm text-gray-600 mb-2">
                  Lien tablette dédié pour le juge priorité.
                </p>
                <button
                  type="button"
                  onClick={handleCopyPriorityLink}
                  className="w-full py-2 px-4 rounded-lg border border-indigo-200 text-indigo-700 font-medium hover:bg-indigo-50 transition-colors"
                >
                  {priorityLinkCopied ? 'Lien priorité copié ✅' : 'Copier le lien juge priorité'}
                </button>
                <div className="mt-2 text-xs text-gray-500 break-all bg-gray-50 p-3 rounded border border-gray-200">
                  {priorityJudgeUrl}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-red-600">
              Impossible de générer le lien pour l’instant. Sauvegardez la configuration puis réessayez.
            </p>
          )}
        </div>
      </details>

      {/* Close Heat */}
      {configSaved && (
        <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden">
          <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-cta-500" />
              <h2 className="text-xl font-bebas tracking-wider text-white">5. GESTION DU HEAT (CLÔTURE)</h2>
            </div>
            <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
          </summary>
          <div className="p-6 bg-white border-t-4 border-primary-950">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Gestion du Heat</h2>
                  <p className="text-sm text-gray-600">
                    Heat actuel: {config.competition} - {config.division} - R{config.round} H{config.heatId}
                  </p>
                </div>
              </div>

              <button
                onClick={handleCloseHeat}
                className="flex items-center space-x-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-lg transform transition hover:scale-105"
              >
                <CheckCircle className="w-5 h-5" />
                <span>Fermer le Heat</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* DEBUG PANEL */}
              <div className="mt-4 p-4 bg-gray-100 rounded text-xs font-mono text-gray-600 overflow-auto max-h-40">
                <p className="font-bold mb-1">🔧 DEBUG INFO:</p>
                <p>Heat: {config.competition} / {config.division} / R{config.round} H{config.heatId}</p>
                <p>Surfers: {config.surfers.join(', ')}</p>
                <p>Loaded from DB: {loadedFromDb ? 'YES' : 'NO'}</p>
                <p>Supabase mode: {getSupabaseMode() || 'auto'}</p>
                <p>DB status: {dbStatus}</p>
                {!loadedFromDb && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                    <p className="font-semibold">⚠️ Configuration non chargée depuis la base.</p>
                    <p>Action recommandée: reconnecter à Supabase puis recharger la config.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={handleAutoReconnect}
                        disabled={reconnectPending || !onReconnectToDb}
                        className="px-2 py-1 bg-amber-200 rounded hover:bg-amber-300 disabled:opacity-50"
                      >
                        {reconnectPending ? 'Reconnexion...' : 'Reconnect to Supabase'}
                      </button>
                      <button
                        onClick={() => navigate('/my-events')}
                        className="px-2 py-1 bg-white border border-amber-300 rounded hover:bg-amber-100"
                      >
                        Ouvrir Mes événements
                      </button>
                    </div>
                    {reconnectMessage && <p className="mt-2">{reconnectMessage}</p>}
                  </div>
                )}
                <button
                  onClick={async () => {
                    try {
                      const eventId = await fetchEventIdByName(config.competition);
                      if (eventId) {
                        const seq = await fetchOrderedHeatSequence(eventId, config.division);
                        console.log('🔥 Heat Sequence:', seq);
                        alert(`Sequence Length: ${seq.length}\nSee console for details.`);
                      } else {
                        alert('Event ID not found');
                      }
                    } catch (e) { alert('Error: ' + e); }
                  }}
                  className="mt-2 px-2 py-1 bg-gray-300 rounded hover:bg-gray-400"
                >
                  Inspect Sequence
                </button>
              </div>
            </div>

            {/* Statistiques des juges */}
            {Object.keys(judgeWorkCount).length > 0 && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Heats consécutifs par juge:</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {Object.entries(judgeWorkCount).map(([judgeId, count]) => (
                    <div key={judgeId} className={`flex items-center justify-between p-2 rounded ${count >= 4 ? 'bg-red-100 text-red-800' :
                      count >= 3 ? 'bg-orange-100 text-orange-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                      <span className="text-sm font-medium">
                        {analyticsJudgeNames.get(judgeId) || config.judgeNames[judgeId] || judgeId}
                      </span>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  🟢 Normal • 🟠 Attention (3+) • 🔴 Fatigue (4+)
                </p>
              </div>
            )}

            {judgeAccuracy.length > 0 && (
              <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Qualité de jugement</h3>
                    <p className="text-xs text-slate-500">
                      Référence: médiane des autres juges par vague, plus corrections du chef juge.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setAnalyticsScope('heat')}
                        className={`px-3 py-1 text-xs ${analyticsScope === 'heat' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'}`}
                      >
                        Heat
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnalyticsScope('event')}
                        disabled={!activeEventId}
                        className={`px-3 py-1 text-xs border-l border-slate-300 ${analyticsScope === 'event' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'} disabled:opacity-50`}
                      >
                        Event
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportJudgeAccuracy}
                      className="px-3 py-1 text-xs bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                {analyticsLoading && (
                  <p className="text-xs text-slate-500 mb-3">Chargement de l’analyse événement...</p>
                )}
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-600 border-b border-slate-200">
                        <th className="py-2 pr-4">Juge</th>
                        <th className="py-2 pr-4">Score</th>
                        <th className="py-2 pr-4">Vagues</th>
                        <th className="py-2 pr-4">Ecart moyen</th>
                        <th className="py-2 pr-4">Biais</th>
                        <th className="py-2 pr-4">Dans +/-0.5</th>
                        <th className="py-2 pr-4">Corrections</th>
                        <th className="py-2">Delta corr.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {judgeAccuracy.map((row) => (
                        <tr
                          key={row.judgeId}
                          onClick={() => setSelectedJudgeProfileId(row.judgeId)}
                          className={`border-b border-slate-100 last:border-b-0 cursor-pointer ${selectedJudgeProfileId === row.judgeId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                        >
                          <td className="py-2 pr-4 font-medium text-slate-900">{analyticsJudgeNames.get(row.judgeId) || row.judgeId}</td>
                          <td className="py-2 pr-4">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                              row.qualityBand === 'excellent' ? 'bg-emerald-100 text-emerald-800' :
                              row.qualityBand === 'good' ? 'bg-sky-100 text-sky-800' :
                              row.qualityBand === 'watch' ? 'bg-amber-100 text-amber-800' :
                              'bg-rose-100 text-rose-800'
                            }`}>
                              {row.qualityScore.toFixed(0)}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-slate-700">{row.scoredWaves}</td>
                          <td className="py-2 pr-4 text-slate-700">{row.meanAbsDeviation.toFixed(2)}</td>
                          <td className={`py-2 pr-4 ${row.bias > 0.15 ? 'text-amber-700' : row.bias < -0.15 ? 'text-sky-700' : 'text-slate-700'}`}>
                            {row.bias > 0 ? '+' : ''}{row.bias.toFixed(2)}
                          </td>
                          <td className="py-2 pr-4 text-slate-700">{row.withinHalfPointRate.toFixed(0)}%</td>
                          <td className="py-2 pr-4 text-slate-700">{row.overrideCount} ({row.overrideRate.toFixed(0)}%)</td>
                          <td className="py-2 text-slate-700">{row.averageOverrideDelta.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedJudgeProfile && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4">
                    <div className="bg-white border border-slate-200 rounded-lg p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Profil juge</p>
                      <h4 className="text-lg font-semibold text-slate-900">
                        {analyticsJudgeNames.get(selectedJudgeProfile.judgeId) || selectedJudgeProfile.judgeId}
                      </h4>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div className="flex justify-between"><span>Score qualité</span><strong>{selectedJudgeProfile.qualityScore.toFixed(0)}/100</strong></div>
                        <div className="flex justify-between"><span>Ecart moyen</span><strong>{selectedJudgeProfile.meanAbsDeviation.toFixed(2)}</strong></div>
                        <div className="flex justify-between"><span>Biais</span><strong>{selectedJudgeProfile.bias > 0 ? '+' : ''}{selectedJudgeProfile.bias.toFixed(2)}</strong></div>
                        <div className="flex justify-between"><span>Notes proches</span><strong>{selectedJudgeProfile.withinHalfPointRate.toFixed(0)}%</strong></div>
                        <div className="flex justify-between"><span>Corrections</span><strong>{selectedJudgeProfile.overrideCount}</strong></div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-200">
                        <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Typologie des corrections</p>
                        <div className="space-y-2 text-sm text-slate-700">
                          <div className="flex justify-between"><span>Correction</span><strong>{selectedJudgeOverrideSummary.correction}</strong></div>
                          <div className="flex justify-between"><span>Omission</span><strong>{selectedJudgeOverrideSummary.omission}</strong></div>
                          <div className="flex justify-between"><span>Problème</span><strong>{selectedJudgeOverrideSummary.probleme}</strong></div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="bg-white border border-slate-200 rounded-lg p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Vagues les plus atypiques</p>
                        {selectedJudgeDeviations.length === 0 ? (
                          <p className="text-sm text-slate-500">Pas assez de données comparables pour ce juge sur le scope sélectionné.</p>
                        ) : (
                          <div className="space-y-2">
                            {selectedJudgeDeviations.map((item) => (
                              <div key={`${item.heatId}-${item.surfer}-${item.waveNumber}`} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                                <div>
                                  <div className="font-medium text-slate-900">
                                    {item.surfer} · Vague {item.waveNumber}
                                  </div>
                                  <div className="text-xs text-slate-500">{item.heatId}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-slate-700">Juge {item.judgeScore.toFixed(2)} vs panel {item.consensusScore.toFixed(2)}</div>
                                  <div className={`text-xs font-semibold ${item.delta > 0 ? 'text-amber-700' : 'text-sky-700'}`}>
                                    {item.delta > 0 ? '+' : ''}{item.delta.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Dernières corrections du juge</p>
                        {selectedJudgeOverrides.length === 0 ? (
                          <p className="text-sm text-slate-500">Aucune correction enregistrée pour ce juge sur le scope sélectionné.</p>
                        ) : (
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {selectedJudgeOverrides.slice(0, 8).map((log) => (
                              <div key={log.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-slate-900">{log.surfer} · Vague {log.wave_number}</span>
                                  <span className="text-xs text-slate-500">{reasonLabels[log.reason]}</span>
                                </div>
                                <div className="mt-1 text-slate-700">
                                  {log.previous_score !== null ? `${log.previous_score.toFixed(2)} → ` : ''}
                                  {log.new_score.toFixed(2)}
                                </div>
                                {log.comment && (
                                  <div className="mt-1 text-xs italic text-slate-500">{log.comment}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      )}
      {/* Paramètres avancés */}
      <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden">
        <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
          <div className="flex items-center space-x-3">
            <Settings className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">6. PARAMÈTRES AVANCÉS</h2>
          </div>
          <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-white border-t-4 border-primary-950 space-y-4">
          {/* JUDGES SECTION */}
          <div className="pt-8 border-t-4 border-primary-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bebas tracking-wide text-primary-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-cta-500" />
                Juges / Officiels
              </h3>
            </div>
            {officialJudgeStatus && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                officialJudgeStatus.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}>
                {officialJudgeStatus.message}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {config.judges.map((judgeId, index) => (
                <div key={judgeId} className="bg-primary-50 border-2 border-primary-950 p-4 rounded-xl shadow-block flex flex-col gap-3">
                  {(() => {
                    const assignedIdentityId = resolveAssignedJudgeIdentity(judgeId);
                    const assignedOfficialJudge = availableOfficialJudges.find((judge) => judge.id === assignedIdentityId);
                    const isOfficialAssigned = Boolean(assignedIdentityId);
                    const manualJudgeName = (config.judgeNames[judgeId] || '').trim();
                    const canCreateOfficial = !isOfficialAssigned && manualJudgeName.length > 0;
                    return (
                      <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-primary-900/60 uppercase tracking-widest">Juge #{index + 1}</span>
                    <button
                      onClick={() => handleRemoveJudge(judgeId)}
                      className="p-1.5 text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <select
                      value={assignedIdentityId}
                      onChange={(e) => handleJudgeIdentityChange(judgeId, e.target.value)}
                      className="w-full px-3 py-2 bg-white border-2 border-primary-200 rounded-lg focus:border-primary-600 focus:ring-0 text-sm font-medium"
                    >
                      <option value="">Sélectionner un juge officiel</option>
                      {availableOfficialJudges.map((judge) => (
                        <option key={judge.id} value={judge.id}>
                          {judge.name}{judge.certification_level ? ` · ${judge.certification_level}` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={config.judgeNames[judgeId] || ''}
                      onChange={(e) => handleJudgeNameChange(judgeId, e.target.value)}
                      placeholder="Nom du Juge"
                      readOnly={isOfficialAssigned}
                      className={`w-full px-3 py-2 bg-white border-2 rounded-lg focus:ring-0 text-sm font-bold ${isOfficialAssigned ? 'border-emerald-300 text-emerald-900 bg-emerald-50 cursor-not-allowed' : 'border-primary-200 focus:border-primary-600'}`}
                    />
                    <input
                      type="email"
                      value={config.judgeEmails?.[judgeId] || ''}
                      onChange={(e) => handleJudgeEmailChange(judgeId, e.target.value)}
                      placeholder="Email (optionnel)"
                      readOnly={isOfficialAssigned}
                      className={`w-full px-3 py-1.5 border rounded-lg focus:ring-0 text-[10px] font-medium ${isOfficialAssigned ? 'bg-emerald-50 border-emerald-200 text-emerald-900 cursor-not-allowed' : 'bg-white/50 border-primary-100 focus:border-primary-400'}`}
                    />
                    <p className="text-[10px] text-primary-700">
                      {isOfficialAssigned
                        ? `Officiel lié: ${assignedOfficialJudge?.name || config.judgeNames[judgeId] || judgeId}`
                        : `Aucune identité officielle liée à ${judgeId}`}
                    </p>
                    {!isOfficialAssigned && (
                      <button
                        type="button"
                        onClick={() => handleCreateOfficialJudge(judgeId)}
                        disabled={!canCreateOfficial || creatingOfficialJudgeFor === judgeId}
                        className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                          canCreateOfficial && creatingOfficialJudgeFor !== judgeId
                            ? 'bg-primary-900 text-white hover:bg-primary-800'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {creatingOfficialJudgeFor === judgeId ? 'Creation en cours...' : 'Creer et lier comme juge officiel'}
                      </button>
                    )}
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))}
              <button
                onClick={handleAddJudge}
                className="p-6 border-4 border-dashed border-primary-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-primary-400 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 transition-all group"
              >
                <PlusCircle className="w-8 h-8 group-hover:scale-110 transition-transform" />
                <span className="font-bebas tracking-widest">Ajouter un Juge</span>
              </button>
            </div>
          </div>

          {/* SURFERS SECTION */}
          <div className="pt-8 border-t-4 border-primary-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bebas tracking-wide text-primary-900 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-cta-500" />
                Surfeurs par Couleur de Lycra
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {(['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'] as const).map((color) => {
                const isAssigned = config.surfers.includes(color);
                return (
                  <div key={color} className={`bg-white border-2 border-primary-950 rounded-xl overflow-hidden shadow-block transition-all ${!isAssigned && 'opacity-50 grayscale'}`}>
                    <div className={`px-4 py-2 border-b-2 border-primary-950 flex items-center justify-between ${color === 'ROUGE' ? 'bg-red-500 text-white' :
                      color === 'BLANC' ? 'bg-slate-100 text-slate-900' :
                        color === 'JAUNE' ? 'bg-yellow-400 text-slate-900' :
                          color === 'BLEU' ? 'bg-blue-600 text-white' :
                            color === 'VERT' ? 'bg-green-600 text-white' :
                              'bg-slate-900 text-white'
                      }`}>
                      <span className="text-[10px] font-bold uppercase tracking-widest">{color}</span>
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...config.surfers, color]
                            : config.surfers.filter(s => s !== color);
                          handleConfigChange('surfers', next);
                        }}
                        className="w-4 h-4 rounded border-white text-primary-600 focus:ring-0 cursor-pointer"
                      />
                    </div>
                    <div className="p-4 space-y-3">
                      <input
                        type="text"
                        value={config.surferNames?.[color] || ''}
                        onChange={(e) => handleSurferNameChange(color, e.target.value)}
                        placeholder="Nom du Surfeur"
                        disabled={!isAssigned}
                        className="w-full px-3 py-2 bg-primary-50 border-2 border-primary-100 rounded-lg focus:border-primary-600 focus:ring-0 text-sm font-bold disabled:bg-gray-50 disabled:border-gray-100"
                      />
                      <input
                        type="text"
                        value={config.surferCountries?.[color] || ''}
                        onChange={(e) => handleSurferCountryChange(color, e.target.value)}
                        placeholder="Pays / Club"
                        disabled={!isAssigned}
                        className="w-full px-3 py-1.5 bg-primary-50/50 border border-primary-100 rounded-lg focus:border-primary-400 focus:ring-0 text-[10px] font-medium disabled:opacity-50"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={onReloadData}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Recharger</span>
            </button>

            <button
              onClick={handleResetAllData}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-bold"
            >
              <Trash2 className="w-4 h-4" />
              <span>🚀 RESET NUCLÉAIRE</span>
            </button>

            <button
              onClick={handleExportPdf}
              className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              <FileText className="w-4 h-4" />
              <span>Export PDF</span>
            </button>

            <button
              onClick={handleExportEventPdf}
              disabled={eventPdfPending}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md text-white ${eventPdfPending
                ? 'bg-purple-300 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700'
                }`}
            >
              <FileText className="w-4 h-4" />
              <span>{eventPdfPending ? 'Export évènement…' : 'Export complet (PDF)'}</span>
            </button>

            <button
              onClick={handleRebuildDivisionQualifiers}
              disabled={rebuildPending || !configSaved}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md text-white ${rebuildPending || !configSaved
                ? 'bg-amber-300 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-700'
                }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>{rebuildPending ? 'Recalcul en cours…' : 'Recalculer qualifiés (division)'}</span>
            </button>

            <button
              onClick={exportData}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              <Download className="w-4 h-4" />
              <span>Export JSON</span>
            </button>
          </div>

          <div className="pt-4 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Code Secret (PIN) pour les Juges
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={config.secretKey || ''}
                onChange={(e) => handleConfigChange('secretKey', e.target.value)}
                placeholder="Ex: 1234"
                className="w-full md:w-1/3 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500">
                Définissez un code simple (ex: 1234) pour permettre aux juges de se connecter sans email.
              </span>
            </div>
          </div>
          <div className="pt-4 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Code Admin Hors-ligne (LAN)
            </label>
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <input
                type="text"
                value={offlineAdminPin}
                onChange={(e) => setOfflineAdminPin(e.target.value)}
                placeholder="Ex: 7890"
                className="w-full md:w-1/3 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleSaveOfflineAdminPin}
                className="px-3 py-2 bg-gray-800 text-white text-sm rounded hover:bg-gray-900"
              >
                Enregistrer
              </button>
              <span className="text-xs text-gray-500">
                Permet d’accéder à /admin sans magic link quand Internet est indisponible.
              </span>
            </div>
          </div>
        </div>
      </details>

      {/* Mode Kiosque - Liens Tablettes */}
      {configSaved && (
        <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden">
          <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
            <div className="flex items-center space-x-3">
              <Users className="w-6 h-6 text-cta-500" />
              <h2 className="text-xl font-bebas tracking-wider text-white">7. MODE KIOSQUE - TABLETTES</h2>
            </div>
            <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
          </summary>
          <div className="p-6 bg-white border-t-4 border-primary-950">
            <p className="text-sm text-gray-600 mb-4">Liens directs pour tablettes J1 à J5</p>
            <div className="space-y-2">
              {["J1", "J2", "J3", "J4", "J5"].map(position => {
                const env = (import.meta as { env?: Record<string, string> }).env ?? {};
                const envBase =
                  getSupabaseMode() === 'local'
                    ? env.VITE_KIOSK_BASE_URL_LAN ||
                    env.VITE_KIOSK_BASE_URL_LOCAL ||
                    env.VITE_SITE_URL_LAN ||
                    env.VITE_SITE_URL_LOCAL ||
                    env.VITE_SITE_URL ||
                    env.VITE_KIOSK_BASE_URL
                    : getSupabaseMode() === 'cloud'
                      ? env.VITE_KIOSK_BASE_URL_CLOUD ||
                      env.VITE_SITE_URL_CLOUD ||
                      env.VITE_KIOSK_BASE_URL ||
                      env.VITE_SITE_URL
                      : env.VITE_KIOSK_BASE_URL || env.VITE_SITE_URL;
                const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
                const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
                // In LAN mode, always prefer the current browser origin so copied links
                // match the live VM IP currently used by tablets/iPhones.
                let kioskBase = (isPrivateHostname(currentHostname) && currentHostname !== 'localhost') ? currentOrigin : '';
                if (!kioskBase && envBase) {
                  try {
                    const url = new URL(envBase);
                    const trimmedPath = url.pathname.replace(/\/+$/, '');
                    kioskBase = `${url.origin}${trimmedPath}`;
                  } catch {
                    kioskBase = envBase.replace(/\/+$/, '');
                  }
                }
                if (!kioskBase) {
                  kioskBase = currentOrigin;
                }

                const eventIdRaw = typeof window !== 'undefined' ? window.localStorage.getItem('surfJudgingActiveEventId') : null;
                const eventIdCandidate = activeEventId ?? (eventIdRaw ? Number(eventIdRaw) : null);
                const eventId = Number.isFinite(Number(eventIdCandidate)) ? Number(eventIdCandidate) : null;
                const kioskUrl = eventId
                  ? `${kioskBase}/judge?position=${position}&eventId=${eventId}`
                  : `${kioskBase}/judge?position=${position}`;
                return (
                  <div key={position} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">{position.replace("J", "")}</div>
                    <input value={kioskUrl} readOnly className="flex-1 px-2 py-1 text-xs font-mono border rounded" />
                    <button onClick={() => navigator.clipboard.writeText(kioskUrl)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded">Copier</button>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      )}

      {/* Override Chef Juge */}
      <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden" open={showOverridePanel}>
        <summary
          className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none"
          onClick={(e) => {
            e.preventDefault();
            setShowOverridePanel(!showOverridePanel);
          }}
        >
          <div className="flex items-center space-x-3">
            <ClipboardCheck className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">8. CORRECTION DE NOTES</h2>
          </div>
          <div className="flex items-center space-x-4">
            {!configSaved && <span className="text-xs text-red-300 font-bold uppercase tracking-widest bg-red-900/50 px-2 py-1 rounded">Non sauvegardé</span>}
            <span className={`text-white transition-transform opacity-70 ${showOverridePanel ? 'rotate-180' : ''}`}>▼</span>
          </div>
        </summary>

        {showOverridePanel && (
          <div className="p-6 bg-white border-t-4 border-primary-950">
            <form className="space-y-4" onSubmit={handleOverrideSubmit}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCorrectionMode('score')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${correctionMode === 'score' ? 'bg-amber-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
                >
                  Mode note
                </button>
                <button
                  type="button"
                  onClick={() => setCorrectionMode('interference')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${correctionMode === 'interference' ? 'bg-amber-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
                >
                  Mode interférence
                </button>
              </div>

              {/* Juge selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Juge</label>
                  <select
                    value={selectedJudge}
                    onChange={(e) => { setSelectedJudge(e.target.value); setOverrideStatus(null); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    required
                  >
                    <option value="">Sélectionner un juge</option>
                    {config.judges.map((judgeId) => (
                      <option key={judgeId} value={judgeId}>
                        {config.judgeNames[judgeId] || judgeId}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Surfer selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Surfeur</label>
                  <select
                    value={selectedSurfer}
                    onChange={(e) => { setSelectedSurfer(e.target.value); setSelectedWave(''); setOverrideStatus(null); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    required
                  >
                    <option value="">Sélectionner un surfeur</option>
                    {config.surfers.map((surfer) => (
                      <option key={surfer} value={surfer}>{surfer}</option>
                    ))}
                  </select>
                </div>

                {/* Wave selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vague</label>
                  <select
                    value={selectedWave}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedWave(value ? Number(value) : '');
                      setOverrideStatus(null);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    required
                  >
                    <option value="">Sélectionner une vague</option>
                    {surferScoredWaves.map((wave) => (
                      <option key={wave} value={wave}>Vague {wave}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Seules les vagues surfées/notées pour ce surfeur sont affichées.
                  </p>
                  {selectedSurfer && surferScoredWaves.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      Aucune vague notée trouvée pour ce surfeur sur ce heat.
                    </p>
                  )}
                </div>

                {correctionMode === 'score' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nouvelle note</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={scoreInput}
                      onChange={(e) => { setScoreInput(e.target.value); setOverrideStatus(null); }}
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type d’interférence</label>
                    <select
                      value={interferenceType}
                      onChange={(e) => setInterferenceType(e.target.value as InterferenceType)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="INT1">Interférence #1 (B/2)</option>
                      <option value="INT2">Interférence #2 (B=0)</option>
                    </select>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={headJudgeOverride}
                        onChange={(e) => setHeadJudgeOverride(e.target.checked)}
                      />
                      Arbitrage Head Judge
                    </label>
                  </div>
                )}
              </div>

              {currentScore && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span>
                    Note actuelle : <strong>{currentScore.score.toFixed(2)}</strong> donnée par {currentScore.judge_name} pour {currentScore.surfer} (Vague {currentScore.wave_number})
                  </span>
                </div>
              )}

              {correctionMode === 'score' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Motif</label>
                    <select
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value as any)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      {Object.keys(reasonLabels).map((r) => (
                        <option key={r} value={r}>{reasonLabels[r as keyof typeof reasonLabels]}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire</label>
                    <input
                      type="text"
                      value={overrideComment}
                      onChange={(e) => setOverrideComment(e.target.value)}
                      placeholder="Optionnel"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              )}

              {correctionMode === 'score' && currentScore && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
                  <p className="text-sm font-medium text-indigo-900">
                    Déplacer une note (mauvais surfeur / mauvaise vague)
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                      value={moveTargetSurfer}
                      onChange={(e) => setMoveTargetSurfer(e.target.value)}
                      className="w-full border border-indigo-300 rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="">Surfeur destination</option>
                      {config.surfers.map((surfer) => (
                        <option key={surfer} value={surfer}>{surfer}</option>
                      ))}
                    </select>
                    <select
                      value={moveTargetWave}
                      onChange={(e) => setMoveTargetWave(Number(e.target.value))}
                      className="w-full border border-indigo-300 rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="">Vague destination</option>
                      {Array.from({ length: config.waves }, (_, i) => i + 1).map((wave) => (
                        <option key={wave} value={wave}>Vague {wave}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleMoveScore}
                    disabled={overridePending || !configSaved}
                    className={`px-4 py-2 rounded-lg font-medium text-white ${overridePending ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'} ${!configSaved ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    Déplacer la note sélectionnée
                  </button>
                </div>
              )}

              {overrideStatus && (
                <div className={`rounded-lg px-4 py-3 text-sm ${overrideStatus.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                  {overrideStatus.message}
                </div>
              )}

              {correctionMode === 'score' ? (
                <button
                  type="submit"
                  disabled={overridePending || !configSaved}
                  className={`px-4 py-2 rounded-lg font-medium text-white ${overridePending ? 'bg-gray-400' : 'bg-amber-600 hover:bg-amber-700'
                    } ${!configSaved ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {overridePending ? 'Application…' : 'Appliquer la correction'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleInterferenceSubmit}
                  disabled={overridePending || !configSaved}
                  className={`px-4 py-2 rounded-lg font-medium text-white ${overridePending ? 'bg-gray-400' : 'bg-amber-600 hover:bg-amber-700'
                    } ${!configSaved ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {overridePending ? 'Application…' : 'Poser l’interférence'}
                </button>
              )}
            </form>
          </div>
        )}
      </details>

      {/* Historique des corrections */}
      <details className="group bg-white rounded-xl shadow-block border-4 border-primary-950 overflow-hidden">
        <summary className="bg-primary-900 p-4 flex justify-between items-center cursor-pointer list-none select-none">
          <div className="flex items-center space-x-3">
            <RotateCcw className="w-6 h-6 text-cta-500" />
            <h2 className="text-xl font-bebas tracking-wider text-white">9. HISTORIQUE DES CORRECTIONS</h2>
          </div>
          <span className="text-white group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-white border-t-4 border-primary-950">
          {overrideLogs.length === 0 ? (
            <p className="text-sm text-gray-500">Aucune correction enregistrée pour ce heat.</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {overrideLogs.map(log => (
                <div key={log.id} className="border border-gray-200 rounded-lg px-4 py-3 text-sm bg-gray-50">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-900">{config.judgeNames[log.judge_id] || log.judge_name}</span>
                    <span className="text-xs text-gray-500">{new Date(log.created_at).toLocaleTimeString('fr-FR')}</span>
                  </div>
                  <div className="mt-1 text-gray-700">
                    {log.surfer} · Vague {log.wave_number}
                  </div>
                  <div className="mt-1 text-gray-700">
                    <span className="font-semibold">{reasonLabels[log.reason]}</span> — {log.previous_score !== null ? `ancien ${log.previous_score.toFixed(2)} → ` : ''}{log.new_score.toFixed(2)}
                  </div>
                  {log.comment && (
                    <div className="mt-1 text-gray-500 italic">{log.comment}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div >
  );
};

export default AdminInterface;
