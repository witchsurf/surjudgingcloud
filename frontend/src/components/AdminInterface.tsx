import React, { useCallback, useEffect, useState } from 'react';
import { Settings, Clock, Users, Download, RotateCcw, Trash2, Database, CheckCircle, ArrowRight, ClipboardCheck, AlertCircle, Info as InfoIcon, Eye, FileText, PlusCircle, Trophy, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
// @ts-ignore - Ignore missing types for qrcode if not installed in environment
import QRCode from 'qrcode';
import HeatTimer from './HeatTimer';
import type { AppConfig, HeatTimer as HeatTimerType, Score, ScoreOverrideLog, OverrideReason, InterferenceType } from '../types';
import { sanitizeScoreInput, validateScore } from '../utils/scoring';
import { buildJudgeDeviationDetails, calculateJudgeAccuracy, calculateSurferStats } from '../utils/scoring';
import { computeEffectiveInterferences } from '../utils/interference';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { SURFER_COLORS as SURFER_COLOR_MAP } from '../utils/constants';
import { colorLabelMap, getColorSet, type HeatColor } from '../utils/colorUtils';
import { exportHeatScorecardPdf, exportFullCompetitionPDF, exportFinalRankingToPDF } from '../utils/pdfExport';
import { fetchHeatScores, fetchEventIdByName, fetchOrderedHeatSequence, fetchAllEventHeats, fetchAllEventCategories, fetchPreferredScoresForEvent, fetchEventJudgeAssignmentCoverage, fetchEventJudgeAccuracySummary, fetchHeatCloseValidation, fetchHeatMissingScoreSlots, fetchAllInterferenceCallsForEvent, fetchHeatEntriesWithParticipants, fetchHeatSlotMappings, fetchHeatMetadata, fetchInterferenceCalls, replaceHeatEntries, ensureEventExists, upsertHeatRealtimeConfig, upsertInterferenceCall, fetchActiveJudges, fetchEventJudgeAssignments, createJudge, applyScoreCorrectionSecure, rebuildDivisionQualifiersFromScores, validateHeatStartDependencies, fetchParticipants, adminOverrideHeatEntry } from '../api/supabaseClient';
import type { Judge, HeatRow, HeatJudgeAssignmentRow, EventJudgeAssignmentCoverageRow, EventJudgeAccuracySummaryRow, HeatEntriesWithParticipantRow, HeatStartDependencyBlocker, ParticipantRecord } from '../api/supabaseClient';
import { supabase, isSupabaseConfigured, getSupabaseConfig, getSupabaseMode } from '../lib/supabase';
import { isPrivateHostname } from '../utils/network';
import { TimerAudio } from '../utils/audioUtils';
import { canonicalizeScores, getScoreJudgeIdentity, getScoreJudgeStation, normalizeScoreJudgeId } from '../api/modules/scoring.api';
import { inferImplicitMappingsForHeat } from '../utils/heatSlotMappingInference';

const ACTIVE_EVENT_STORAGE_KEY = 'surfJudgingActiveEventId';
const LINEUP_OVERRIDE_COLORS = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'] as const;

type LineupOverrideDraft = {
  participantId: string;
  manualName: string;
  country: string;
  reason: string;
};

type LineupOverrideStatus = {
  type: 'success' | 'error' | 'info';
  message: string;
};

const generateJudgePersonalCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const normalizeJudgeProfileKey = (value?: string | null) =>
  (value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');

const getJudgeLookupKeys = (value?: string | null) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return [];
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  return Array.from(new Set([trimmed, upper, lower]));
};

const encodeCsvCell = (value: string | number) => {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const formatOverrideContext = (heatId: string, score?: Partial<Score>) => {
  const parsed = fetchHeatContext(heatId, score);
  return `${parsed.division} · R${parsed.round} · H${parsed.heatNumber}`;
};

const fetchHeatContext = (heatId: string, score?: Partial<Score>) => {
  const parsed = (() => {
    const match = ensureHeatId(heatId).match(/^(.+)_([^_]+)_r(\d+)_h(\d+)$/i);
    if (!match) return null;
    return {
      division: match[2].toUpperCase(),
      round: Number(match[3]),
      heatNumber: Number(match[4]),
    };
  })();

  return {
    division: (score?.division || parsed?.division || 'HEAT').toString().toUpperCase(),
    round: Number(score?.round ?? parsed?.round ?? 0),
    heatNumber: Number(parsed?.heatNumber ?? 0),
  };
};


interface AdminInterfaceProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onConfigSaved: (saved: boolean) => void;
  configSaved: boolean;
  loadError?: string | null;
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
  const [displayQrCode, setDisplayQrCode] = useState('');
  const [judgeAccessLinkCopied, setJudgeAccessLinkCopied] = useState(false);
  const [judgeAccessQrCode, setJudgeAccessQrCode] = useState('');
  const [priorityLinkCopied, setPriorityLinkCopied] = useState(false);
  const [priorityQrCode, setPriorityQrCode] = useState('');
  const [eventPdfPending, setEventPdfPending] = useState(false);
  const [rankingPdfPending, setRankingPdfPending] = useState(false);
  const [eventPdfMeta, setEventPdfMeta] = useState<{ organizer: string; startDate: string }>(() => {
    try {
      const data = JSON.parse(localStorage.getItem('eventData') || '{}');
      return {
        organizer: String(data.organizerDisplayName || data.organizer_display_name || data.organizer || ''),
        startDate: String(data.startDateOverride || data.start_date_override || data.start_date || ''),
      };
    } catch {
      return { organizer: '', startDate: '' };
    }
  });
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
  const [dbOverrideLogs, setDbOverrideLogs] = useState<ScoreOverrideLog[]>([]);
  const [analyticsScope, setAnalyticsScope] = useState<'heat' | 'event'>('heat');
  const [eventAccuracyScores, setEventAccuracyScores] = useState<Score[]>([]);
  const [eventAccuracyOverrides, setEventAccuracyOverrides] = useState<ScoreOverrideLog[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [selectedJudgeProfileId, setSelectedJudgeProfileId] = useState<string | null>(null);
  const [showClosedHeats, setShowClosedHeats] = useState(false);
  const [allEventHeatsMeta, setAllEventHeatsMeta] = useState<Array<{ division: string; round: number; heat_number: number; status: string }>>([]);
  const [isTimerOpen, setIsTimerOpen] = useState(true);
  const [rejudgeOverrideHeatKey, setRejudgeOverrideHeatKey] = useState<string | null>(null);
  const [rejudgeConfirmText, setRejudgeConfirmText] = useState('');
  const [rejudgeOverridePending, setRejudgeOverridePending] = useState(false);
  const [rejudgeOverrideError, setRejudgeOverrideError] = useState<string | null>(null);
  const [heatStartBlockers, setHeatStartBlockers] = useState<HeatStartDependencyBlocker[]>([]);
  const [heatStartDependencyChecking, setHeatStartDependencyChecking] = useState(false);
  const [floatingTimerTick, setFloatingTimerTick] = useState(Date.now());
  const [availableOfficialJudges, setAvailableOfficialJudges] = useState<Judge[]>([]);
  const [officialJudgeStatus, setOfficialJudgeStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [creatingOfficialJudgeFor, setCreatingOfficialJudgeFor] = useState<string | null>(null);
  const [eventJudgeAssignments, setEventJudgeAssignments] = useState<HeatJudgeAssignmentRow[]>([]);
  const [assignmentCoverageRows, setAssignmentCoverageRows] = useState<EventJudgeAssignmentCoverageRow[]>([]);
  const [eventJudgeAccuracySummary, setEventJudgeAccuracySummary] = useState<EventJudgeAccuracySummaryRow[]>([]);
  const [lineupRows, setLineupRows] = useState<HeatEntriesWithParticipantRow[]>([]);
  const [lineupParticipantOptions, setLineupParticipantOptions] = useState<ParticipantRecord[]>([]);
  const [lineupDrafts, setLineupDrafts] = useState<Record<number, LineupOverrideDraft>>({});
  const [lineupOverrideStatus, setLineupOverrideStatus] = useState<LineupOverrideStatus | null>(null);
  const [lineupOverrideLoading, setLineupOverrideLoading] = useState(false);
  const [lineupPendingPosition, setLineupPendingPosition] = useState<number | null>(null);
  const [lineupRefreshToken, setLineupRefreshToken] = useState(0);
  // Stable latch: once a heat is locked/closed, never flicker back to unlocked within session
  const hasBeenLockedRef = React.useRef(false);
  // Track which heat the latch was set for, so we can reset on heat change
  const lockedForHeatRef = React.useRef<string>('');
  const configRef = React.useRef(config);
  const lineupLoadRequestRef = React.useRef(0);

  useEffect(() => {
    const syncFromLocalStorage = () => {
      try {
        const data = JSON.parse(localStorage.getItem('eventData') || '{}');
        setEventPdfMeta({
          organizer: String(data.organizerDisplayName || data.organizer_display_name || data.organizer || ''),
          startDate: String(data.startDateOverride || data.start_date_override || data.start_date || ''),
        });
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', syncFromLocalStorage);
    return () => window.removeEventListener('storage', syncFromLocalStorage);
  }, []);

  const persistEventPdfMeta = useCallback((patch: Partial<{ organizer: string; startDate: string }>) => {
    setEventPdfMeta((current) => {
      const next = { ...current, ...patch };
      try {
        const data = JSON.parse(localStorage.getItem('eventData') || '{}');
        data.organizerDisplayName = next.organizer;
        data.startDateOverride = next.startDate;
        localStorage.setItem('eventData', JSON.stringify(data));
        window.dispatchEvent(new Event('storage'));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const formatEventDateFr = useCallback((value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    // Accept ISO date or timestamp; fall back to raw string if parsing fails.
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

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

  const resolveEventIdForCurrentHeat = useCallback(async (): Promise<number | null> => {
    if (activeEventId) {
      return activeEventId;
    }

    if (heatId) {
      const heatMetadata = await fetchHeatMetadata(heatId);
      if (heatMetadata?.event_id) {
        return heatMetadata.event_id;
      }
    }

    try {
      const persistedEventIdRaw = localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY) || localStorage.getItem('eventId');
      const persistedEventId = persistedEventIdRaw ? Number(persistedEventIdRaw) : NaN;
      if (Number.isFinite(persistedEventId) && persistedEventId > 0) {
        return persistedEventId;
      }
    } catch {
      // Ignore storage access failures and continue fallback chain.
    }

    if (config.competition) {
      return await fetchEventIdByName(config.competition);
    }

    return null;
  }, [activeEventId, config.competition, heatId]);

  useEffect(() => {
    setPlannedTimerDuration(timer.duration);
    setHeatStartBlockers([]);
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
      const key = `${ensureHeatId(score.heat_id)}::${getScoreJudgeStation(score)}::${normalizeJerseyLabel(score.surfer)}::${Number(score.wave_number)}`;
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

  const effectiveOverrideLogs = React.useMemo(() => {
    const byId = new Map<string, ScoreOverrideLog>();
    [...(overrideLogs || []), ...(dbOverrideLogs || [])].forEach((log) => {
      if (!log?.id) return;
      byId.set(log.id, log);
    });
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }, [dbOverrideLogs, overrideLogs]);

  const resetCorrectionForm = useCallback(() => {
    setSelectedJudge('');
    setSelectedSurfer('');
    setSelectedWave('');
    setMoveTargetSurfer('');
    setMoveTargetWave('');
    setScoreInput('');
    setOverrideComment('');
    setHeadJudgeOverride(false);
    setInterferenceType('INT1');
  }, []);

  const refreshCorrectionPanelData = useCallback(async () => {
    if (!supabase) throw new Error('Supabase non initialisé');

    try {
      const [{ data: scoreRows, error: scoresError }, { data: overrideRows, error: overridesError }] = await Promise.all([
        supabase
          .from('scores')
          .select('*')
          .eq('heat_id', heatId)
          .order('created_at', { ascending: true }),
        supabase
          .from('score_overrides')
          .select('*')
          .eq('heat_id', heatId)
          .order('created_at', { ascending: false }),
      ]);

      if (scoresError) throw scoresError;
      if (overridesError) throw overridesError;

      const nextScores = (scoreRows || []) as Score[];
      setDbHeatScoreHistory(nextScores);
      setDbHeatScores(canonicalizeScores(nextScores));
      setDbOverrideLogs((overrideRows || []) as ScoreOverrideLog[]);
    } catch (error) {
      console.warn('⚠️ Base de données inaccessible - chargement des scores locaux de secours', error);
      
      // Fallback: Read from IndexedDB / localStorage cache!
      const { getScoresByHeatIDB } = await import('../lib/idbStorage');
      const localScores = await getScoresByHeatIDB([heatId]);
      
      // Also read local override logs from localStorage
      const localLogsRaw = localStorage.getItem('surfJudgingOverrideLogs');
      const localLogs = localLogsRaw ? (JSON.parse(localLogsRaw) as ScoreOverrideLog[]).filter(log => log.heat_id === heatId) : [];

      setDbHeatScoreHistory(localScores);
      setDbHeatScores(canonicalizeScores(localScores));
      setDbOverrideLogs(localLogs);
    }
  }, [heatId]);

  useEffect(() => {
    let cancelled = false;

    const loadDbScores = async () => {
      try {
        await refreshCorrectionPanelData();
      } catch (error) {
        if (!cancelled) {
          console.warn('⚠️ Impossible de charger les données de correction pour le panel admin:', error);
        }
      }
    };

    loadDbScores();

    const handleOverrideEvent = () => {
      void loadDbScores();
    };
    window.addEventListener('scoreOverrideApplied', handleOverrideEvent as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('scoreOverrideApplied', handleOverrideEvent as EventListener);
    };
  }, [heatId, refreshCorrectionPanelData]);

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
      .sort((a, b) => new Date(b.created_at || b.timestamp || 0).getTime() - new Date(a.created_at || a.timestamp || 0).getTime())[0];
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
    () => remapOverrideLogsToJudgeIdentity(effectiveOverrideLogs, currentHeatIdentityMap),
    [currentHeatIdentityMap, effectiveOverrideLogs, remapOverrideLogsToJudgeIdentity]
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

  const scoreById = React.useMemo(() => {
    const byId = new Map<string, Score>();
    [
      ...dbHeatScoreHistory,
      ...dbHeatScores,
      ...analyticsHeatScores,
      ...analyticsEventScores,
      ...scores,
    ].forEach((score) => {
      if (!score?.id) return;
      byId.set(score.id, score);
    });
    return byId;
  }, [analyticsEventScores, analyticsHeatScores, dbHeatScoreHistory, dbHeatScores, scores]);

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

  const eventJudgeProfiles = React.useMemo(() => {
    const groups = new Map<string, {
      judgeId: string;
      judgeName: string;
      memberIds: Set<string>;
      scoredWaves: number;
      consensusSamples: number;
      deviationWeightedSum: number;
      biasWeightedSum: number;
      withinHalfPointWeightedSum: number;
      overrideCount: number;
      overrideDeltaWeightedSum: number;
    }>();

    const judgeNamesByIdentity = new Map<string, string>();
    const setJudgeName = (judgeId?: string | null, judgeName?: string | null) => {
      const trimmedName = (judgeName || '').trim();
      if (!trimmedName) return;
      getJudgeLookupKeys(judgeId).forEach((key) => {
        if (!judgeNamesByIdentity.has(key)) {
          judgeNamesByIdentity.set(key, trimmedName);
        }
      });
    };

    availableOfficialJudges.forEach((judge) => setJudgeName(judge.id, judge.name));
    Object.entries(config.judgeIdentities || {}).forEach(([station, identityId]) => {
      const judgeName = (config.judgeNames?.[station] || config.judgeNames?.[station.trim().toUpperCase()] || '').trim();
      setJudgeName(identityId, judgeName);
    });
    [...analyticsHeatScores, ...analyticsEventScores, ...dbHeatScores, ...dbHeatScoreHistory].forEach((score) => {
      setJudgeName(score.judge_identity_id || score.judge_id, score.judge_name);
    });
    [...analyticsHeatOverrides, ...analyticsEventOverrides].forEach((log) => {
      setJudgeName(log.judge_identity_id || log.judge_id, log.judge_name);
    });

    eventJudgeAccuracySummary.forEach((row) => {
      const judgeIdentityId = (row.judge_identity_id || '').trim();
      const judgeName = (
        getJudgeLookupKeys(judgeIdentityId)
          .map((key) => judgeNamesByIdentity.get(key))
          .find(Boolean)
        || row.judge_display_name
        || row.judge_identity_id
        || ''
      ).trim();
      const groupKey = normalizeJudgeProfileKey(judgeName || row.judge_identity_id);
      if (!groupKey) return;

      const existing = groups.get(groupKey) ?? {
        judgeId: `event::${groupKey}`,
        judgeName,
        memberIds: new Set<string>(),
        scoredWaves: 0,
        consensusSamples: 0,
        deviationWeightedSum: 0,
        biasWeightedSum: 0,
        withinHalfPointWeightedSum: 0,
        overrideCount: 0,
        overrideDeltaWeightedSum: 0,
      };

      if (judgeIdentityId) {
        existing.memberIds.add(judgeIdentityId);
      }
      existing.scoredWaves += row.scored_waves;
      existing.consensusSamples += row.consensus_samples;
      existing.deviationWeightedSum += row.mean_abs_deviation * row.consensus_samples;
      existing.biasWeightedSum += row.bias * row.consensus_samples;
      existing.withinHalfPointWeightedSum += row.within_half_point_rate * row.consensus_samples;
      existing.overrideCount += row.override_count;
      existing.overrideDeltaWeightedSum += row.average_override_delta * row.override_count;
      groups.set(groupKey, existing);
    });

    const rows = Array.from(groups.values())
      .map((group) => {
        const meanAbsDeviation = group.consensusSamples > 0
          ? Number((group.deviationWeightedSum / group.consensusSamples).toFixed(2))
          : 0;
        const bias = group.consensusSamples > 0
          ? Number((group.biasWeightedSum / group.consensusSamples).toFixed(2))
          : 0;
        const withinHalfPointRate = group.consensusSamples > 0
          ? Number((group.withinHalfPointWeightedSum / group.consensusSamples).toFixed(2))
          : 0;
        const overrideRate = group.scoredWaves > 0
          ? Number(((group.overrideCount / group.scoredWaves) * 100).toFixed(2))
          : 0;
        const averageOverrideDelta = group.overrideCount > 0
          ? Number((group.overrideDeltaWeightedSum / group.overrideCount).toFixed(2))
          : 0;
        const deviationPenalty = Math.min(45, meanAbsDeviation * 30);
        const biasPenalty = Math.min(15, Math.abs(bias) * 20);
        const overridePenalty = Math.min(20, overrideRate * 0.5);
        const withinBonus = Math.min(10, withinHalfPointRate * 0.1);
        const qualityScore = Number(
          Math.max(0, Math.min(100, 100 - deviationPenalty - biasPenalty - overridePenalty + withinBonus)).toFixed(2)
        );
        const qualityBand =
          qualityScore >= 85 ? 'excellent' :
          qualityScore >= 70 ? 'good' :
          qualityScore >= 55 ? 'watch' :
          'needs_review';

        return {
          judgeId: group.judgeId,
          judgeName: group.judgeName,
          memberIds: Array.from(group.memberIds).sort(),
          scoredWaves: group.scoredWaves,
          consensusSamples: group.consensusSamples,
          meanAbsDeviation,
          bias,
          withinHalfPointRate,
          overrideCount: group.overrideCount,
          overrideRate,
          averageOverrideDelta,
          qualityScore,
          qualityBand,
        };
      })
      .sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        if (a.meanAbsDeviation !== b.meanAbsDeviation) return a.meanAbsDeviation - b.meanAbsDeviation;
        return a.judgeId.localeCompare(b.judgeId);
      });

    return {
      rows,
      namesByProfileId: new Map(rows.map((row) => [row.judgeId, row.judgeName])),
      membersByProfileId: new Map(rows.map((row) => [row.judgeId, row.memberIds])),
    };
  }, [
    analyticsEventOverrides,
    analyticsEventScores,
    analyticsHeatOverrides,
    analyticsHeatScores,
    availableOfficialJudges,
    config.judgeIdentities,
    config.judgeNames,
    dbHeatScoreHistory,
    dbHeatScores,
    eventJudgeAccuracySummary,
  ]);

  const judgeAccuracy = React.useMemo(() => {
    if (analyticsScope !== 'event' || !eventJudgeAccuracySummary.length) {
      return localJudgeAccuracy;
    }

    return eventJudgeProfiles.rows;
  }, [analyticsScope, eventJudgeAccuracySummary.length, eventJudgeProfiles.rows, localJudgeAccuracy]);

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

    eventJudgeProfiles.namesByProfileId.forEach((judgeName, judgeId) => {
      if (judgeId && judgeName) {
        names.set(judgeId, judgeName);
      }
    });

    return names;
  }, [analyticsEventOverrides, analyticsEventScores, analyticsHeatOverrides, analyticsHeatScores, availableOfficialJudges, config.judgeIdentities, config.judgeNames, dbHeatScoreHistory, dbHeatScores, eventJudgeAccuracySummary, eventJudgeProfiles.namesByProfileId]);

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
    if (analyticsScope === 'event' && selectedJudgeProfileId.startsWith('event::')) {
      const matchingJudgeIds = eventJudgeProfiles.membersByProfileId.get(selectedJudgeProfileId) || [];
      return matchingJudgeIds
        .flatMap((judgeId) => buildJudgeDeviationDetails(analysisScores, judgeId))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 8);
    }
    return buildJudgeDeviationDetails(analysisScores, selectedJudgeProfileId).slice(0, 8);
  }, [analyticsEventScores, analyticsHeatScores, analyticsScope, eventJudgeProfiles.membersByProfileId, selectedJudgeProfileId]);

  const selectedJudgeOverrides = React.useMemo(() => {
    if (!selectedJudgeProfileId) return [];
    const sourceLogs = analyticsScope === 'event' ? analyticsEventOverrides : analyticsHeatOverrides;
    if (analyticsScope === 'event' && selectedJudgeProfileId.startsWith('event::')) {
      const matchingJudgeIds = new Set(eventJudgeProfiles.membersByProfileId.get(selectedJudgeProfileId) || []);
      return sourceLogs.filter((log) => {
        const judgeId = (log.judge_identity_id || log.judge_id || '').trim();
        return judgeId ? matchingJudgeIds.has(judgeId) : false;
      });
    }
    return sourceLogs.filter((log) => log.judge_id === selectedJudgeProfileId);
  }, [analyticsEventOverrides, analyticsHeatOverrides, analyticsScope, eventJudgeProfiles.membersByProfileId, selectedJudgeProfileId]);

  const selectedJudgeOverridesDetailed = React.useMemo(() => {
    return selectedJudgeOverrides.map((log) => {
      const relatedScore = scoreById.get(log.score_id);
      const context = fetchHeatContext(log.heat_id, relatedScore);
      return {
        ...log,
        contextLabel: formatOverrideContext(log.heat_id, relatedScore),
        division: context.division,
        round: context.round,
        heatNumber: context.heatNumber,
      };
    });
  }, [scoreById, selectedJudgeOverrides]);

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
      ['scope', 'judge_id', 'judge_name', 'quality_score', 'quality_band', 'scored_waves', 'consensus_samples', 'mean_abs_deviation', 'bias', 'within_half_point_rate', 'override_count', 'override_rate', 'average_override_delta'].map(encodeCsvCell).join(';'),
      ...judgeAccuracy.map((row) => ([
        analyticsScope,
        row.judgeId,
        analyticsJudgeNames.get(row.judgeId) || row.judgeId,
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
      ].map(encodeCsvCell).join(';')))
    ];

    const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
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
        await refreshCorrectionPanelData();
        resetCorrectionForm();
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
    const destinationExistingScore = mergedScores.find(
      (score) =>
        ensureHeatId(score.heat_id) === heatId &&
        (score.judge_id === resolvedJudgeIdMove || score.judge_station === selectedJudge || score.judge_id === selectedJudge) &&
        normalizeJerseyLabel(score.surfer) === moveTargetSurferKey &&
        score.wave_number === Number(moveTargetWave) &&
        score.id !== currentScore.id
    );

    setOverridePending(true);
    try {
      if (!supabase) throw new Error('Supabase non initialisé');
      const destinationWave = Number(moveTargetWave);
      const destinationSurfer = moveTargetSurferKey;

      const moveComment = [
        `Déplacement de ${normalizeJerseyLabel(selectedSurfer)} V${selectedWave} vers ${destinationSurfer} V${destinationWave}.`,
        destinationExistingScore
          ? `Destination remplacée: ancienne note ${destinationExistingScore.score.toFixed(2)}.`
          : '',
        overrideComment.trim(),
      ].filter(Boolean).join(' ');

      await applyScoreCorrectionSecure({
        score_id: currentScore.id,
        heat_id: heatId,
        surfer: destinationSurfer,
        wave_number: destinationWave,
        timestamp: new Date().toISOString(),
        override_log: {
          id: crypto.randomUUID(),
          heat_id: heatId,
          score_id: currentScore.id,
          judge_id: currentScore.judge_id,
          judge_name: currentScore.judge_name,
          judge_station: currentScore.judge_station || selectedJudge,
          judge_identity_id: currentScore.judge_identity_id || null,
          surfer: destinationSurfer,
          wave_number: destinationWave,
          previous_score: currentScore.score,
          new_score: currentScore.score,
          reason: 'correction',
          comment: moveComment,
          overridden_by: 'chief_judge',
          overridden_by_name: 'Chef Judge',
          created_at: new Date().toISOString(),
        },
      });

      const updatedScore: Score = {
        ...currentScore,
        surfer: destinationSurfer,
        wave_number: destinationWave,
        timestamp: new Date().toISOString(),
      };

      setOverrideStatus({
        type: 'success',
        message: destinationExistingScore
          ? `Note déplacée vers ${destinationSurfer} · Vague ${destinationWave}; l’ancienne note de destination reste dans l’historique.`
          : `Note déplacée vers ${destinationSurfer} · Vague ${destinationWave}.`
      });
      resetCorrectionForm();
      await refreshCorrectionPanelData();
      window.dispatchEvent(new CustomEvent('newScoreRealtime', { detail: updatedScore }));
      // Broadcast score change so judge tablets immediately refresh their grid
      window.dispatchEvent(new CustomEvent('scoreOverrideApplied', {
        detail: {
          heatId,
          judgeId: resolvedJudgeIdMove,
          action: 'move',
          fromSurfer: normalizeJerseyLabel(selectedSurfer),
          toSurfer: destinationSurfer,
          wave: destinationWave,
          replacedScoreId: destinationExistingScore?.id || null
        }
      }));
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
      const eventId = await resolveEventIdForCurrentHeat();
      if (!eventId) {
        throw new Error('Événement introuvable pour enregistrer l’interférence.');
      }
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
      resetCorrectionForm();
      await refreshCorrectionPanelData();
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

  const kioskBaseUrl = React.useMemo(() => {
    if (typeof window === 'undefined') return '';

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

    const currentOrigin = window.location.origin;
    const currentHostname = window.location.hostname;
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

    return kioskBase || currentOrigin;
  }, []);

  const buildAccessUrl = React.useCallback((pathname: string) => {
    const base = kioskBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return null;
    const url = new URL(base);
    url.pathname = pathname;
    return url;
  }, [kioskBaseUrl]);

  const publicDisplayUrl = React.useMemo(() => {
    const url = buildAccessUrl('/display');
    if (!url) return '';

    // Use eventId if available (Preferred for cross-device sync)
    if (activeEventId) {
      url.searchParams.set('eventId', activeEventId.toString());
    } else if (encodedDisplayPayload) {
      // Fallback to config payload (Legacy/Offline)
      url.searchParams.set('config', encodedDisplayPayload);
    }
    return url.toString();
  }, [activeEventId, buildAccessUrl, encodedDisplayPayload]);

  const kioskEventId = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    const eventIdRaw = window.localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY);
    const eventIdCandidate = activeEventId ?? (eventIdRaw ? Number(eventIdRaw) : null);
    const eventId = Number.isFinite(Number(eventIdCandidate)) ? Number(eventIdCandidate) : null;
    return eventId;
  }, [activeEventId]);

  const shouldShowKioskPanel = React.useMemo(
    () => configSaved || loadedFromDb || Boolean(kioskEventId),
    [configSaved, loadedFromDb, kioskEventId]
  );

  const sharedJudgeAccessUrl = React.useMemo(() => {
    if (!kioskBaseUrl) return '';
    return kioskEventId
      ? `${kioskBaseUrl}/judge?eventId=${kioskEventId}`
      : `${kioskBaseUrl}/judge`;
  }, [kioskBaseUrl, kioskEventId]);

  const priorityJudgeUrl = React.useMemo(() => {
    const url = buildAccessUrl('/priority');
    if (!url) return '';

    if (activeEventId) {
      url.searchParams.set('eventId', activeEventId.toString());
    }

    return url.toString();
  }, [activeEventId, buildAccessUrl]);

  const handleOpenDisplay = () => {
    if (!publicDisplayUrl) return;
    window.open(publicDisplayUrl, '_blank', 'noopener');
  };

  const copyTextSafely = async (value: string) => {
    if (!value || typeof navigator === 'undefined') return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {
      console.warn('Clipboard API indisponible, fallback copy:', error);
    }

    if (typeof document === 'undefined') return false;

    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch (error) {
      console.warn('Impossible de copier le texte:', error);
      return false;
    }
  };

  const handleCopyDisplayLink = async () => {
    if (!publicDisplayUrl) return;
    try {
      const copied = await copyTextSafely(publicDisplayUrl);
      if (!copied) return;
      setDisplayLinkCopied(true);
      window.setTimeout(() => setDisplayLinkCopied(false), 2000);
    } catch (error) {
      console.warn('Impossible de copier le lien affichage:', error);
    }
  };

  const handleCopyJudgeAccessLink = async () => {
    if (!sharedJudgeAccessUrl) return;
    try {
      const copied = await copyTextSafely(sharedJudgeAccessUrl);
      if (!copied) return;
      setJudgeAccessLinkCopied(true);
      window.setTimeout(() => setJudgeAccessLinkCopied(false), 2000);
    } catch (error) {
      console.warn('Impossible de copier le lien juges:', error);
    }
  };

  const handleCopyPriorityLink = async () => {
    if (!priorityJudgeUrl) return;
    try {
      const copied = await copyTextSafely(priorityJudgeUrl);
      if (!copied) return;
      setPriorityLinkCopied(true);
      window.setTimeout(() => setPriorityLinkCopied(false), 2000);
    } catch (error) {
      console.warn('Impossible de copier le lien priorité:', error);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const buildDisplayQrCode = async () => {
      if (!publicDisplayUrl) {
        if (!cancelled) setDisplayQrCode('');
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(publicDisplayUrl, {
          width: 220,
          margin: 1,
          color: {
            dark: '#1f1147',
            light: '#ffffff',
          },
        });
        if (!cancelled) {
          setDisplayQrCode(dataUrl);
        }
      } catch (error) {
        console.warn('Impossible de générer le QR code du display:', error);
        if (!cancelled) {
          setDisplayQrCode('');
        }
      }
    };

    buildDisplayQrCode().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [publicDisplayUrl]);

  useEffect(() => {
    let cancelled = false;

    const buildJudgeQrCode = async () => {
      if (!sharedJudgeAccessUrl) {
        if (!cancelled) setJudgeAccessQrCode('');
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(sharedJudgeAccessUrl, {
          width: 220,
          margin: 1,
          color: {
            dark: '#3b0764',
            light: '#ffffff',
          },
        });
        if (!cancelled) {
          setJudgeAccessQrCode(dataUrl);
        }
      } catch (error) {
        console.warn('Impossible de générer le QR code juges:', error);
        if (!cancelled) {
          setJudgeAccessQrCode('');
        }
      }
    };

    buildJudgeQrCode().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sharedJudgeAccessUrl]);

  useEffect(() => {
    let cancelled = false;

    const buildPriorityQrCode = async () => {
      if (!priorityJudgeUrl) {
        if (!cancelled) setPriorityQrCode('');
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(priorityJudgeUrl, {
          width: 220,
          margin: 1,
          color: {
            dark: '#312e81',
            light: '#ffffff',
          },
        });
        if (!cancelled) {
          setPriorityQrCode(dataUrl);
        }
      } catch (error) {
        console.warn('Impossible de générer le QR code priorité:', error);
        if (!cancelled) {
          setPriorityQrCode('');
        }
      }
    };

    buildPriorityQrCode().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [priorityJudgeUrl]);

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
    const isHeatSelectionField = field === 'division' || field === 'round' || field === 'heatId';
    const nextConfig = {
      ...config,
      [field]: value,
      ...(isHeatSelectionField
        ? {
            surferNames: {},
            surferCountries: {},
          }
        : {}),
    };
    onConfigChange(nextConfig);
  };

  useEffect(() => {
    let cancelled = false;
    const loadEventDivisions = async () => {
      if (!isSupabaseConfigured() || !config.competition) {
        setEventDivisionOptions([]);
        return;
      }

      try {
        const eventId = await resolveEventIdForCurrentHeat();
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

  useEffect(() => {
    if (!loadedFromDb || !heatId || !isSupabaseConfigured()) {
      setLineupRows([]);
      setLineupParticipantOptions([]);
      return;
    }

    let cancelled = false;
    const requestId = lineupLoadRequestRef.current + 1;
    lineupLoadRequestRef.current = requestId;

    const loadSelectedHeatLineup = async () => {
      try {
        const [entries, heatMeta, slotMappings] = await Promise.all([
          fetchHeatEntriesWithParticipants(heatId),
          fetchHeatMetadata(heatId),
          fetchHeatSlotMappings(heatId).catch(() => []),
        ]);
        const participants = activeEventId
          ? await fetchParticipants(activeEventId).catch((error) => {
              console.warn('Impossible de charger les participants pour l’override lineup:', error);
              return [] as ParticipantRecord[];
            })
          : [];

        if (cancelled || lineupLoadRequestRef.current !== requestId) return;
        setLineupRows(entries);
        setLineupParticipantOptions(
          participants.filter((participant) =>
            String(participant.category || '').trim().toLowerCase() === String(config.division || '').trim().toLowerCase()
          )
        );
        setLineupDrafts((current) => {
          const next = { ...current };
          entries.forEach((entry) => {
            if (next[entry.position]) return;
            next[entry.position] = {
              participantId: entry.participant_id ? String(entry.participant_id) : '',
              manualName: entry.participant?.name || '',
              country: entry.participant?.country || '',
              reason: '',
            };
          });
          return next;
        });

        const entryColors = entries
          .map((entry) => String(entry.color ?? '').trim().toUpperCase())
          .filter(Boolean);
        const orderedHeatColors = Array.isArray(heatMeta?.color_order)
          ? heatMeta.color_order
              .map((value) => String(value ?? '').trim().toUpperCase())
              .filter(Boolean)
          : [];
        const inferredHeatSize = Math.max(
          Number(heatMeta?.heat_size ?? 0),
          Array.isArray(slotMappings) ? slotMappings.length : 0,
          entryColors.length,
          Array.isArray(configRef.current.surfers) ? configRef.current.surfers.length : 0
        );
        const fallbackColors = inferredHeatSize > 0
          ? getColorSet(inferredHeatSize).map((color) => colorLabelMap[color] ?? color)
          : [];
        const normalizedOrderedHeatColors = orderedHeatColors.map((color) => {
          const heatColor = color as HeatColor;
          return colorLabelMap[heatColor] ?? color;
        });
        const nextSurfers = normalizedOrderedHeatColors.length > 0
          ? normalizedOrderedHeatColors
          : fallbackColors;

        const surferNames: Record<string, string> = {};
        const surferCountries: Record<string, string> = {};

        entries.forEach((entry) => {
          const rawColor = String(entry.color ?? '').trim().toUpperCase();
          const color = rawColor ? (colorLabelMap[rawColor as HeatColor] ?? rawColor) : '';
          if (!color) return;
          if (entry.participant?.name) {
            surferNames[color] = entry.participant.name;
          }
          if (entry.participant?.country) {
            surferCountries[color] = entry.participant.country;
          }
        });

        const currentConfig = configRef.current;
        const sameHeat =
          currentConfig.division === config.division &&
          Number(currentConfig.round) === Number(config.round) &&
          Number(currentConfig.heatId) === Number(config.heatId);

        if (!sameHeat) return;

        onConfigChange({
          ...currentConfig,
          surfers: nextSurfers.length > 0 ? nextSurfers : currentConfig.surfers,
          surferNames,
          surferCountries,
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('Impossible de recharger le lineup du heat sélectionné dans l’admin:', error);
        }
      }
    };

    void loadSelectedHeatLineup();

    return () => {
      cancelled = true;
    };
  }, [loadedFromDb, heatId, activeEventId, config.division, config.round, config.heatId, lineupRefreshToken, onConfigChange]);

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

    // Only a live "closed" status should override the DB sequence.
    // "finished" can linger during heat switches and must not lock a new OPEN heat.
    if (liveStatus === 'closed') {
      return liveStatus;
    }

    return dbStatus || liveStatus || 'waiting';
  }, [divisionHeatSequence, config.round, config.heatId, heatStatus]);

  const isCurrentHeatLocked = isLockedStatus(currentHeatStatus);
  // Latch: once locked, never un-lock due to DB/realtime race — BUT reset when user switches heat
  const currentHeatKey = `${config.competition}::${config.division}::${config.round}::${config.heatId}`;
  if (lockedForHeatRef.current !== currentHeatKey) {
    // User switched to a different heat — reset the latch
    hasBeenLockedRef.current = false;
    lockedForHeatRef.current = currentHeatKey;
  }

  useEffect(() => {
    setSelectedJudge('');
    setSelectedSurfer('');
    setSelectedWave('');
    setMoveTargetSurfer('');
    setMoveTargetWave('');
    setScoreInput('');
    setOverrideComment('');
    setOverrideStatus(null);
    setHeadJudgeOverride(false);
    setInterferenceType('INT1');
    setRejudgeConfirmText('');
    setRejudgeOverrideError(null);
  }, [currentHeatKey]);

  useEffect(() => {
    if (isCurrentHeatLocked) {
        hasBeenLockedRef.current = true;
    }
  }, [isCurrentHeatLocked]);

  const stableHeatLocked = hasBeenLockedRef.current;
  const currentHeatScoreCount = React.useMemo(
    () =>
      mergedScores.filter(
        (score) => ensureHeatId(score.heat_id) === heatId && Number(score.score) > 0
      ).length,
    [heatId, mergedScores]
  );
  const currentHeatHasScores = currentHeatScoreCount > 0;
  const currentHeatLooksAlreadyJudged = currentHeatHasScores && !timer.isRunning && !timer.startTime;
  const rejudgeOverrideActive = rejudgeOverrideHeatKey === currentHeatKey;
  const heatRejudgeProtected = (stableHeatLocked || currentHeatLooksAlreadyJudged) && !rejudgeOverrideActive;
  const rejudgeProtectionReason = stableHeatLocked
    ? 'closed'
    : currentHeatLooksAlreadyJudged
      ? 'scores'
      : null;
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

  const handleTimerStart = async () => {
    if (!judgeAssignmentStatus.isReady) {
      setSyncError(`Affectations juges incomplètes: ${judgeAssignmentErrorMessage}`);
      return;
    }
    if (!(await ensureHeatCanStart())) return;

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
    if (heatRejudgeProtected) {
      setIsTimerOpen(true);
      setRejudgeOverrideError('Heat protégé: confirmez le mode REJUGER avant de relancer le timer.');
      return;
    }
    handleTimerStart().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setSyncError(`Impossible de reprendre le timer: ${message}`);
    });
  };

  const handleRejudgeOverrideEnable = async () => {
    if (rejudgeConfirmText.trim().toUpperCase() !== 'REJUGER') {
      setRejudgeOverrideError('Tapez REJUGER pour confirmer la réouverture exceptionnelle.');
      return;
    }

    setRejudgeOverridePending(true);
    setRejudgeOverrideError(null);

    try {
      if (isSupabaseConfigured() && supabase) {
        const { error: heatError } = await supabase
          .from('heats')
          .update({ status: 'open', closed_at: null })
          .eq('id', heatId);

        if (heatError) {
          throw heatError;
        }

        await upsertHeatRealtimeConfig(heatId, {
          status: 'waiting',
          setTimerStartTime: true,
          timerStartTime: null,
          setTimerDuration: true,
          timerDurationMinutes: Math.max(1, plannedTimerDuration || timer.duration || 20),
          updatedBy: 'head_judge_rejudge_override',
        });
      }

      const resetTimer = {
        ...timer,
        isRunning: false,
        startTime: null,
        duration: Math.max(1, plannedTimerDuration || timer.duration || 20),
      };
      onTimerChange(resetTimer);
      localStorage.setItem('surfJudgingTimer', JSON.stringify(resetTimer));
      setRejudgeOverrideHeatKey(currentHeatKey);
      setRejudgeConfirmText('');
      hasBeenLockedRef.current = false;
      setAllEventHeatsMeta((rows) =>
        rows.map((row) =>
          row.division === config.division &&
          Number(row.round) === Number(config.round) &&
          Number(row.heat_number) === Number(config.heatId)
            ? { ...row, status: 'open' }
            : row
        )
      );
      setDivisionHeatSequence((rows) =>
        rows.map((row) =>
          Number(row.round) === Number(config.round) &&
          Number(row.heat_number) === Number(config.heatId)
            ? { ...row, status: 'open' }
            : row
        )
      );
      setSyncError(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setRejudgeOverrideError(`Impossible d'activer le mode REJUGER: ${detail}`);
    } finally {
      setRejudgeOverridePending(false);
    }
  };

  const formatHeatStartDependencyError = useCallback((blockers: HeatStartDependencyBlocker[]) => {
    if (!blockers.length) {
      return 'Heat bloqué: les qualifiés nécessaires ne sont pas encore disponibles.';
    }

    const details = blockers
      .slice(0, 4)
      .map((blocker) => {
        if (blocker.message) return blocker.message;
        const source = blocker.source_round && blocker.source_heat
          ? `R${blocker.source_round} H${blocker.source_heat}`
          : 'source inconnue';
        const position = blocker.source_position ? ` P${blocker.source_position}` : '';
        return `${source}${position} indisponible.`;
      })
      .join(' ');

    return `Démarrage bloqué: ${details} Recalculez les qualifiés ou corrigez le lineup avant de lancer ce heat.`;
  }, []);

  const ensureHeatCanStart = useCallback(async () => {
    if (!isSupabaseConfigured() || !supabase) {
      setHeatStartBlockers([]);
      return true;
    }

    setHeatStartDependencyChecking(true);
    try {
      const dependencyCheck = await validateHeatStartDependencies(heatId);
      if (!dependencyCheck.ok) {
        const blockers = dependencyCheck.blockers || [];
        setHeatStartBlockers(blockers);
        setSyncError(formatHeatStartDependencyError(blockers));
        setIsTimerOpen(true);
        return false;
      }

      setHeatStartBlockers([]);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('RPC_UNAVAILABLE:')) {
        console.warn('Validation des dépendances de heat indisponible, démarrage non bloqué côté interface.', error);
        setHeatStartBlockers([]);
        return true;
      }

      const message = error instanceof Error ? error.message : String(error);
      setSyncError(`Impossible de valider les qualifiés avant démarrage: ${message}`);
      setIsTimerOpen(true);
      return false;
    } finally {
      setHeatStartDependencyChecking(false);
    }
  }, [formatHeatStartDependencyError, heatId]);

  const handleTimerStartImpl = async () => {
    if (!configSaved || heatRejudgeProtected || (isCurrentHeatLocked && !rejudgeOverrideActive)) return;
    if (!judgeAssignmentStatus.isReady) {
      setSyncError(`Affectations juges incomplètes: ${judgeAssignmentErrorMessage}`);
      return;
    }
    if (!(await ensureHeatCanStart())) return;
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

  const handleTimerRestartFull = async () => {
    if (!configSaved) return;
    if (heatRejudgeProtected) {
      setIsTimerOpen(true);
      setRejudgeOverrideError('Heat protégé: confirmez le mode REJUGER avant de recommencer.');
      return;
    }
    if (!judgeAssignmentStatus.isReady) {
      setSyncError(`Affectations juges incomplètes: ${judgeAssignmentErrorMessage}`);
      return;
    }
    if (!(await ensureHeatCanStart())) return;
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
      const eventId = await resolveEventIdForCurrentHeat();
      if (!eventId) {
        throw new Error('Événement introuvable.');
      }

      try {
        const updatedSlots = await rebuildDivisionQualifiersFromScores(eventId, config.division);
        setOverrideStatus({
          type: 'success',
          message: `Qualifiés recalculés côté base pour ${config.division}. Slots mis à jour: ${updatedSlots}.`
        });
        onReloadData();
        return;
      } catch (error) {
        if (error instanceof Error && !error.message.startsWith('RPC_UNAVAILABLE:')) {
          throw error;
        }
        console.warn('Rebuild métier côté base indisponible, fallback client conservé', error);
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
        let mappings = await fetchHeatSlotMappings(targetHeat.id);
        if (!mappings.length && supabase) {
          const inferredMappings = inferImplicitMappingsForHeat(sequence, targetHeat.id);
          if (inferredMappings.length) {
            const { error: mappingsError } = await supabase
              .from('heat_slot_mappings')
              .upsert(inferredMappings, { onConflict: 'heat_id,position' });

            if (mappingsError) {
              console.warn(`Impossible de reconstruire les mappings du heat ${targetHeat.id}`, mappingsError);
            } else {
              mappings = inferredMappings;
            }
          }
        }
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
              const stats = calculateSurferStats(sourceScores, surfers, judgeCount, maxWaves, true, effectiveInterferences, sourceHeat.status)
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
    // First rely on the database view so close validation uses the same source of truth
    // regardless of local cache, judge aliasing, or offline replay timing.
    let pending: string[] = [];
    let hasAnyScoresFromDb: boolean | null = null;
    try {
      const closeValidation = await fetchHeatCloseValidation(heatId);
      if (closeValidation) {
        hasAnyScoresFromDb = closeValidation.has_any_scores;
        pending = closeValidation.pending_slots.map((slot) =>
          `${(slot.judge_display_name || slot.judge_station).trim()} → ${normalizeJerseyLabel(slot.surfer)} V${Number(slot.wave_number)}`
        );
      } else {
        const missingSlots = await fetchHeatMissingScoreSlots(heatId);
        pending = missingSlots.map((slot) =>
          `${(slot.judge_display_name || slot.judge_station).trim()} → ${normalizeJerseyLabel(slot.surfer)} V${Number(slot.wave_number)}`
        );
      }
    } catch (error) {
      if (!(error instanceof Error) || (!error.message.startsWith('FUNCTION_NOT_READY:') && !error.message.startsWith('VIEW_NOT_READY:'))) {
        console.warn('Impossible de charger la validation DB de fermeture du heat:', error);
      }

      try {
        const missingSlots = await fetchHeatMissingScoreSlots(heatId);
        pending = missingSlots.map((slot) =>
        `${(slot.judge_display_name || slot.judge_station).trim()} → ${normalizeJerseyLabel(slot.surfer)} V${Number(slot.wave_number)}`
        );
      } catch (viewError) {
        if (!(viewError instanceof Error) || !viewError.message.startsWith('VIEW_NOT_READY:')) {
          console.warn('Impossible de charger la vue DB des notes manquantes:', viewError);
        }

        // Fallback local check if the DB validation is not yet available.
        let heatScoresForCheck = (mergedScores || []).filter(
          s => ensureHeatId(s.heat_id) === heatId && Number(s.score) > 0
        );

        if (heatScoresForCheck.length === 0) {
          try {
            const dbScores = await fetchHeatScores(heatId);
            heatScoresForCheck = dbScores.filter(
              s => ensureHeatId(s.heat_id) === heatId && Number(s.score) > 0
            );
          } catch (scoreError) {
            console.warn('Impossible de charger les scores DB pour vérifier les notes manquantes:', scoreError);
          }
        }

        const safeIdent = Object.fromEntries(
          Object.entries(config.judgeIdentities || {}).map(([k, v]) => [k.trim().toUpperCase(), (v || '').trim()])
        );
        const configuredJudges = (config.judges || []).map((station) => {
          const normalizedStation = (station || '').trim().toUpperCase();
          const identityId = (safeIdent[normalizedStation] || '').trim();
          const matchKeys = new Set(
            [normalizedStation, normalizeScoreJudgeId(normalizedStation), identityId, normalizeScoreJudgeId(identityId)]
              .map((value) => (value || '').trim().toUpperCase())
              .filter(Boolean)
          );

          return {
            station,
            normalizedStation,
            identityId,
            matchKeys,
          };
        }).filter((judge) => judge.matchKeys.size > 0);

        if (configuredJudges.length > 0 && heatScoresForCheck.length > 0) {
          hasAnyScoresFromDb = true;
          const startedWaveKeys = new Set<string>();
          heatScoresForCheck.forEach(s => {
            const surfer = normalizeJerseyLabel(s.surfer);
            startedWaveKeys.add(`${surfer}::${Number(s.wave_number)}`);
          });

          configuredJudges.forEach((judge) => {
            startedWaveKeys.forEach((key) => {
              const [surfer, waveRaw] = key.split('::');
              const waveNumber = Number(waveRaw);
              const hasScore = heatScoresForCheck.some(
                (s) => {
                  if (normalizeJerseyLabel(s.surfer) !== surfer || Number(s.wave_number) !== waveNumber) {
                    return false;
                  }

                  const scoreKeys = new Set(
                    [
                      getScoreJudgeIdentity(s),
                      getScoreJudgeStation(s),
                      normalizeScoreJudgeId(s.judge_id),
                    ]
                      .map((value) => (value || '').trim().toUpperCase())
                      .filter(Boolean)
                  );

                  return Array.from(scoreKeys).some((scoreKey) => judge.matchKeys.has(scoreKey));
                }
              );

              if (hasScore) return;

              const upperJudgeId = (judge.identityId || judge.normalizedStation).trim().toUpperCase();
              const stationForJudge = judge.station;

              const judgeName = (
                config.judgeNames?.[stationForJudge] ||
                config.judgeNames?.[judge.normalizedStation] ||
                (availableOfficialJudges.find(j => j.id?.trim().toUpperCase() === upperJudgeId)?.name) ||
                stationForJudge
              ).trim();

              pending.push(`${judgeName} → ${surfer} V${waveNumber}`);
            });
          });
        } else {
          hasAnyScoresFromDb = heatScoresForCheck.length > 0;
        }
      }
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

    let canCloseWithoutWarning = hasAnyScoresFromDb ?? canCloseHeat();

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
      const eventId = await resolveEventIdForCurrentHeat();

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

  const lineupDisplayRows = React.useMemo(() => {
    const byPosition = new Map<number, HeatEntriesWithParticipantRow>();
    lineupRows.forEach((row) => byPosition.set(row.position, row));

    const configuredColors = Array.from(new Set([
      ...config.surfers,
      ...LINEUP_OVERRIDE_COLORS,
    ]));

    return configuredColors.map((color, index) => {
      const position = index + 1;
      const row = byPosition.get(position);
      return {
        color,
        position,
        row: row ?? {
          color,
          position,
          participant_id: null,
          seed: null,
          participant: null,
        } satisfies HeatEntriesWithParticipantRow,
      };
    }).filter((item) => {
      const isConfigured = config.surfers.includes(item.color);
      const hasDbEntry = Boolean(item.row.participant_id || item.row.participant?.name);
      return isConfigured || hasDbEntry;
    });
  }, [config.surfers, lineupRows]);

  const updateLineupDraft = (position: number, patch: Partial<LineupOverrideDraft>) => {
    setLineupDrafts((current) => {
      const existing = current[position] || { participantId: '', manualName: '', country: '', reason: '' };
      return {
        ...current,
        [position]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const handleApplyLineupOverride = async (position: number, color: string) => {
    if (!heatId) {
      setLineupOverrideStatus({ type: 'error', message: 'Aucun heat actif pour appliquer cet override.' });
      return;
    }

    const draft = lineupDrafts[position] || { participantId: '', manualName: '', country: '', reason: '' };
    const participantId = draft.participantId ? Number(draft.participantId) : null;
    const selectedParticipant = participantId
      ? lineupParticipantOptions.find((participant) => participant.id === participantId)
      : null;
    const manualName = draft.manualName.trim();
    const resolvedName = selectedParticipant?.name || manualName;

    if (!participantId && !resolvedName) {
      setLineupOverrideStatus({ type: 'error', message: 'Choisis un participant existant ou saisis un nouveau nom.' });
      return;
    }

    const hasScoresForColor = mergedScores.some((score) =>
      ensureHeatId(score.heat_id) === heatId &&
      normalizeJerseyLabel(score.surfer) === normalizeJerseyLabel(color)
    );

    if (hasScoresForColor) {
      const confirmed = window.confirm(
        `Confirmer l'override ${color} ?\n\nLes notes déjà posées restent attachées à la couleur ${color}. Seule l'identité officielle du surfeur est changée.`
      );
      if (!confirmed) return;
    }

    setLineupPendingPosition(position);
    setLineupOverrideLoading(true);
    setLineupOverrideStatus({ type: 'info', message: 'Application de la nouvelle mouture du heat...' });

    try {
      const result = await adminOverrideHeatEntry({
        heatId,
        position,
        color,
        participantId,
        name: participantId ? null : resolvedName,
        country: participantId ? null : (draft.country.trim() || null),
        reason: draft.reason.trim() || 'Override chef juge terrain',
        createdBy: 'admin_advanced_lineup_override',
      });

      const normalizedColor = normalizeJerseyLabel(result.color || color);
      const nextSurfers = config.surfers.includes(normalizedColor)
        ? config.surfers
        : [...config.surfers, normalizedColor];
      const nextConfig: AppConfig = {
        ...config,
        surfers: nextSurfers,
        surferNames: {
          ...(config.surferNames || {}),
          [normalizedColor]: result.name,
        },
        surferCountries: {
          ...(config.surferCountries || {}),
          [normalizedColor]: result.country || '',
        },
      };

      onConfigChange(nextConfig);
      setLineupDrafts((current) => ({
        ...current,
        [position]: {
          participantId: String(result.participant_id),
          manualName: result.name,
          country: result.country || '',
          reason: '',
        },
      }));
      setLineupRefreshToken((value) => value + 1);
      setLineupOverrideStatus({
        type: 'success',
        message: `${normalizedColor}: ${result.name} est maintenant le surfeur officiel du heat. Les scores existants n'ont pas été modifiés.`,
      });
      onReloadData();
    } catch (error) {
      console.error('Impossible d’appliquer l’override lineup:', error);
      setLineupOverrideStatus({
        type: 'error',
        message: 'Override impossible. Vérifie que les migrations Supabase sont appliquées sur le HP/cloud.',
      });
    } finally {
      setLineupPendingPosition(null);
      setLineupOverrideLoading(false);
    }
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
          const organizerCandidate =
            eventData.organizerDisplayName ||
            eventData.organizer_display_name ||
            eventData?.config?.eventDetails?.organizer ||
            eventData.organizer;
          organizer = organizerCandidate ? String(organizerCandidate).trim().toUpperCase() : undefined;

          const dateCandidate =
            eventData.startDateOverride ||
            eventData.start_date_override ||
            eventData?.config?.eventDetails?.date ||
            eventData.start_date;
          eventDate = formatEventDateFr(dateCandidate);

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
      await exportFullCompetitionPDF({
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

  const handleExportFinalRankingPdf = async () => {
    const eventIdRaw = localStorage.getItem('activeEventId') || localStorage.getItem('eventId');
    const eventIdFromUrl = Number(new URLSearchParams(window.location.search).get('eventId'));
    const eventId =
      activeEventId
      ?? (Number.isFinite(eventIdFromUrl) && eventIdFromUrl > 0 ? eventIdFromUrl : null)
      ?? (eventIdRaw ? Number(eventIdRaw) : NaN);

    if (!eventId || Number.isNaN(eventId)) {
      alert('Aucun événement actif trouvé.');
      return;
    }

    setRankingPdfPending(true);
    try {
      // 1. Fetch data
      const divisionsData = await fetchAllEventHeats(eventId);
      const allHeats: HeatRow[] = Object.entries(divisionsData)
        .flatMap(([category, rounds]) => 
          (rounds || []).flatMap(round => 
            (round.heats || []).map(heat => ({
              id: heat.heatId || '',
              event_id: eventId,
              competition: config.competition,
              division: category, // Use the real category name as key
              round: round.roundNumber || 0,
              heat_number: heat.heatNumber || 0,
              heat_size: heat.slots?.length || 0,
              status: heat.status || 'open', // Real status from DB
              color_order: (heat.slots || []).map((s: any) => s?.color || '') as string[],
              slots: heat.slots // Pass full slots for surfer discovery
            }))
          )
        );

      const allScores = await fetchPreferredScoresForEvent(eventId);
      const allInterferenceCalls = await fetchAllInterferenceCallsForEvent(eventId);
      const participants = await fetchParticipants(eventId);

      // 2. Resolve metadata
      let organizer: string | undefined;
      let eventDate: string | undefined;
      let organizerLogoDataUrl: string | undefined;
      let resolvedEventName = config.competition || 'Compétition';

      if (supabase) {
        const { data: dbEventData } = await supabase.from('events').select('*').eq('id', eventId).single();
        if (dbEventData) {
          resolvedEventName = dbEventData.name || resolvedEventName;
          const localEventData = JSON.parse(localStorage.getItem('eventData') || '{}');
          const eventData = { ...localEventData, ...dbEventData };

          const organizerCandidate =
            eventData.organizerDisplayName ||
            eventData.organizer_display_name ||
            eventData?.config?.eventDetails?.organizer ||
            eventData.organizer;
          organizer = organizerCandidate ? String(organizerCandidate).trim().toUpperCase() : undefined;

          const dateCandidate =
            eventData.startDateOverride ||
            eventData.start_date_override ||
            eventData?.config?.eventDetails?.date ||
            eventData.start_date;
          eventDate = formatEventDateFr(dateCandidate);

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

      // 3. Export
      console.log('✅ Divisions trouvées pour export:', Object.keys(divisionsData));
      console.log('✅ Total séries traitées:', allHeats.length);
      
      exportFinalRankingToPDF({
        eventName: resolvedEventName,
        organizer,
        organizerLogoDataUrl,
        date: eventDate,
        heats: allHeats,
        scores: allScores,
        interferenceCalls: allInterferenceCalls,
        participants,
        divisions: Object.keys(divisionsData)
      });

      console.log('✅ Classement final généré avec succès');
    } catch (error) {
      console.error('Erreur export ranking:', error);
      alert('Erreur lors de la génération du classement.');
    } finally {
      setRankingPdfPending(false);
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
    <div className="min-h-screen bg-hud-black text-slate-100 p-4 sm:p-6 font-sans space-y-6">
      {/* Statut de la base de données & Contexte - Collapsible */}
      <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40" open>
        <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
          <div className="flex items-center space-x-3">
            <Database className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">1. CONTEXTE ÉVÉNEMENT & BDD</h2>
          </div>
          <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-slate-950/20 flex flex-col space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              <Database className={`w-5 h-5 ${isSupabaseConfigured() ? 'text-green-400' : 'text-slate-500'}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Database: <span className={isSupabaseConfigured() ? 'text-green-400 font-extrabold' : 'text-slate-400'}>
                  {isSupabaseConfigured() ? 'CONNECTED' : 'LOCAL ONLY'}
                </span>
              </span>
            </div>
          </div>

          <div className="mt-2 mb-6 p-4 rounded-xl border border-white/5 bg-slate-900/40 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wider text-slate-200 uppercase">Contexte événement</h3>
              <span className="text-xs font-mono text-slate-400">
                event_id: {activeEventId ?? 'N/A'} · {loadedFromDb ? 'chargé depuis DB' : 'local only'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Événement</label>
                <input
                  type="text"
                  value={config.competition}
                  onChange={(e) => handleConfigChange('competition', e.target.value)}
                  placeholder="Nom de l'événement"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Division</label>
                <select
                  value={config.division}
                  onChange={(e) => handleConfigChange('division', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {activeDivisionOptions.map((division) => {
                    const closed = isCategoryClosed(division);
                    return (
                      <option key={division} value={division} disabled={!showClosedHeats && closed} className={!showClosedHeats && closed ? "text-slate-500 bg-slate-950" : "text-slate-100 bg-slate-950"}>
                        {division} {!showClosedHeats && closed ? '(Terminé)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Organisateur (PDF)</label>
                <input
                  type="text"
                  value={eventPdfMeta.organizer}
                  onChange={(e) => persistEventPdfMeta({ organizer: e.target.value })}
                  placeholder="Ex: LIGUE PRO"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Date (PDF)</label>
                <input
                  type="date"
                  value={(eventPdfMeta.startDate || '').slice(0, 10)}
                  onChange={(e) => persistEventPdfMeta({ startDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div className="md:col-span-2 pt-2 border-t border-white/5">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Logo de l'organisateur</label>
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0 h-16 w-16 bg-slate-950 rounded-xl border-2 border-dashed border-slate-800 flex items-center justify-center overflow-hidden">
                    {(() => {
                      const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
                      const logo = eventData.organizerLogoDataUrl || eventData.image_url || eventData.brand_logo_url;
                      return logo ? (
                        <img src={logo} alt="Logo" className="h-full w-full object-contain" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-slate-600" />
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
                      className="block w-full text-xs text-slate-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
                    />
                    <p className="mt-1 text-[10px] text-slate-500">PNG/JPG recommandé. Apparaîtra sur les exports PDF.</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Round</label>
                <select
                  value={config.round}
                  onChange={(e) => handleConfigChange('round', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {visibleRoundOptions.map((round) => {
                    const closed = isRoundClosed(round);
                    return (
                      <option key={round} value={round} disabled={!showClosedHeats && closed} className={!showClosedHeats && closed ? "text-slate-500 bg-slate-950" : "text-slate-100 bg-slate-950"}>
                        Round {round} {!showClosedHeats && closed ? '(Terminé)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Heat</label>
                <select
                  value={config.heatId}
                  onChange={(e) => handleConfigChange('heatId', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {visibleHeatOptions.map((heat) => {
                    const closed = isHeatClosed(heat, config.round);
                    return (
                      <option key={heat} value={heat} disabled={!showClosedHeats && closed} className={!showClosedHeats && closed ? "text-slate-500 bg-slate-950" : "text-slate-100 bg-slate-950"}>
                        Heat {heat} {!showClosedHeats && closed ? '(Terminé)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              
              <div className="md:col-span-2 pt-2 border-t border-white/5 flex items-center justify-between flex-wrap gap-2">
                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showClosedHeats}
                    onChange={(e) => setShowClosedHeats(e.target.checked)}
                    className="w-4 h-4 text-cyan-500 border-slate-800 bg-slate-950 rounded focus:ring-cyan-500"
                  />
                  <span>Afficher les séries terminées (Clôturées)</span>
                </label>
                <div className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-white/5 px-2 py-1 rounded">
                  Status Actuel : <strong className="uppercase text-cyan-400">{currentHeatStatus}</strong>
                </div>
              </div>
            </div>

            {/* Diagnostic sub-panel */}
            <details className="mt-4 group border border-white/5 rounded-xl bg-slate-950/60 overflow-hidden shadow-inner">
              <summary className="bg-slate-900/80 px-4 py-3 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
                <div className="flex items-center space-x-2 text-cyan-400">
                  <Settings className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">🔧 Outils de Connexion & Diagnostic BDD</span>
                </div>
                <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
              </summary>
              <div className="p-4 space-y-4 text-xs font-mono text-slate-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="space-y-1 p-2 bg-slate-900/80 rounded border border-white/5">
                    <p className="font-bold text-slate-400">📊 STATUT GENERAL :</p>
                    <p>Série : <span className="text-cyan-400">{config.competition} / {config.division} / R{config.round} H{config.heatId}</span></p>
                    <p>Surfeurs : <span className="text-cyan-400">{config.surfers.join(', ')}</span></p>
                    <p>Chargé depuis base : <span className={loadedFromDb ? "text-green-400" : "text-amber-400 font-bold"}>{loadedFromDb ? 'OUI' : 'NON (LOCAL ONLY)'}</span></p>
                  </div>
                  <div className="space-y-1 p-2 bg-slate-900/80 rounded border border-white/5">
                    <p className="font-bold text-slate-400">🌐 STATUS SUPABASE :</p>
                    <p>Mode Supabase : <span className="text-cyan-400">{getSupabaseMode() || 'auto'}</span></p>
                    <p>Statut Connexion : <span className="text-cyan-400">{dbStatus}</span></p>
                    <p>Configuration active : <span className="text-cyan-400">{isSupabaseConfigured() ? 'VALIDE' : 'ABSENTE'}</span></p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleAutoReconnect}
                    disabled={reconnectPending || !onReconnectToDb}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded-lg disabled:opacity-50 transition-colors text-xs font-sans"
                  >
                    {reconnectPending ? 'Reconnexion...' : 'Reconnecter Supabase'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/my-events')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/5 rounded-lg transition-colors text-xs font-sans"
                  >
                    Ouvrir Mes événements
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const eventId = await resolveEventIdForCurrentHeat();
                        if (eventId) {
                          const seq = await fetchOrderedHeatSequence(eventId, config.division);
                          console.log('🔥 Heat Sequence:', seq);
                          alert(`Sequence Length: ${seq.length}\nSee console for details.`);
                        } else {
                          alert('Event ID not found');
                        }
                      } catch (e) { alert('Error: ' + e); }
                    }}
                    className="px-3 py-1.5 bg-purple-900/60 hover:bg-purple-800/60 text-purple-200 border border-purple-800/40 rounded-lg transition-colors text-xs font-sans"
                  >
                    Inspecter la Séquence BDD
                  </button>
                </div>
                {reconnectMessage && (
                  <p className="mt-2 text-xs text-amber-400 bg-amber-950/20 p-2 rounded border border-amber-900/30">
                    {reconnectMessage}
                  </p>
                )}
              </div>
            </details>
          </div>
        </div>
      </details>

      {/* Configuration Juges et Surfeurs - Collapsible (Fermé par défaut) */}
      <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40">
        <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
          <div className="flex items-center space-x-3">
            <Users className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">2. JUGES ET SURFEURS</h2>
          </div>
          <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-slate-950/20 flex flex-col space-y-6">

          {/* Nombre de Juges (Mode Kiosk) */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Nombre de Juges</label>
            <select
              value={config.judges.length}
              onChange={(e) => {
                const numJudges = parseInt(e.target.value);
                const judgeIds = Array.from({ length: numJudges }, (_, i) => `J{i + 1}`);
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
              className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="3" className="bg-slate-950">3 Juges (J1, J2, J3)</option>
              <option value="4" className="bg-slate-950">4 Juges (J1, J2, J3, J4)</option>
              <option value="5" className="bg-slate-950">5 Juges (J1, J2, J3, J4, J5)</option>
            </select>
            <p className="mt-2 text-xs text-slate-500">
              Les juges utiliseront le mode kiosque avec leurs positions (J1, J2, etc.)
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h4 className="text-sm font-bold tracking-wider text-slate-200 uppercase">Couverture des affectations officielles</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {eventAssignmentSummary.completeHeats}/{eventAssignmentSummary.totalHeats} heats complets
                  {eventAssignmentSummary.incompleteHeats > 0 ? ` · ${eventAssignmentSummary.incompleteHeats} à compléter` : ''}
                </p>
              </div>
              <div className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${eventAssignmentSummary.incompleteHeats > 0 ? 'bg-amber-950/40 border-amber-800/40 text-amber-300' : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'}`}>
                {eventAssignmentSummary.incompleteHeats > 0 ? 'Vérification requise' : 'Complet'}
              </div>
            </div>

            {eventAssignmentCoverage.length === 0 ? (
              <p className="text-xs text-slate-500 font-mono">Aucun heat détecté pour cet événement.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {eventAssignmentCoverage.map((heat) => (
                  <div key={heat.heatId} className="rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-200">
                        {heat.division} · R{heat.round} H{heat.heatNumber}
                      </div>
                      <div className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${heat.missingStations.length > 0 ? 'bg-amber-950/40 border-amber-800/40 text-amber-300' : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'}`}>
                        {heat.missingStations.length > 0 ? `Manque: ${heat.missingStations.join(', ')}` : 'Complet'}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400 font-mono">
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
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Surfeurs du heat</label>
            <div className="mt-1 mb-4 flex items-start space-x-2 text-xs text-slate-400 bg-slate-900/40 border border-white/5 rounded-xl p-3">
              <InfoIcon className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
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
                    <div key={`${surfer}-${index}`} className="flex items-center space-x-2 p-2 bg-slate-900/60 rounded-lg border border-white/5">
                      <div
                        className="w-4 h-4 rounded-full border border-white/10"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-semibold text-slate-200">{surfer}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 bg-amber-950/20 border border-amber-800/40 rounded-lg text-sm text-amber-300">
                Aucun surfeur détecté pour ce heat. Vérifiez les entrées dans Supabase puis rechargez la configuration.
              </div>
            )}
          </div>

          <button
            onClick={handleSaveConfig}
            disabled={configSaved || loadState === 'loading' || !judgeAssignmentStatus.isReady}
            className={`w-full py-4 px-6 rounded-xl font-bebas text-2xl tracking-widest transition-all shadow-lg flex justify-center items-center gap-2 border border-white/5 ${configSaved
              ? 'bg-emerald-950/40 text-emerald-400 cursor-not-allowed opacity-80'
              : !judgeAssignmentStatus.isReady
                ? 'bg-amber-950/40 text-amber-400 cursor-not-allowed opacity-90'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white font-medium hover:-translate-y-0.5 active:translate-y-0 shadow-cyan-900/20'
              }`}
          >
            {configSaved ? (
              <>
                <CheckCircle className="w-6 h-6 text-emerald-400" /> CONFIGURATION SAUVEGARDÉE
              </>
            ) : !judgeAssignmentStatus.isReady ? (
              <>
                AFFECTATIONS JUGES INCOMPLÈTES
              </>
            ) : (
              <>
                SAUVEGARDER LA CONFIGURATION
              </>
            )}
          </button>
        </div>
      </details>

      {/* Timer */}
      <details 
        className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40" 
        open={isTimerOpen} 
        onToggle={(e) => setIsTimerOpen(e.currentTarget.open)}
      >
        <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
          <div className="flex items-center space-x-3">
            <Clock className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">3. CHRONOMÈTRE</h2>
          </div>
          <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-slate-950/20 flex flex-col space-y-4">
          {syncError && (
            <div className="w-full p-2.5 bg-red-950/40 border border-red-800/40 rounded-lg text-red-400 text-xs font-bold font-mono animate-pulse">
              {syncError}
            </div>
          )}
          {(heatRejudgeProtected || rejudgeOverrideActive) && (
            <div className={`w-full p-4 rounded-xl border ${
              rejudgeOverrideActive
                ? 'bg-emerald-950/30 border-emerald-800/40'
                : 'bg-red-950/40 border-red-700/60 shadow-[0_0_30px_rgba(185,28,28,0.18)]'
            }`}>
              <div className="flex items-start gap-3">
                <AlertCircle className={`w-6 h-6 mt-0.5 flex-shrink-0 ${rejudgeOverrideActive ? 'text-emerald-300' : 'text-red-300 animate-pulse'}`} />
                <div className="min-w-0 flex-1">
                  <h4 className={`text-sm font-black uppercase tracking-widest ${rejudgeOverrideActive ? 'text-emerald-300' : 'text-red-200'}`}>
                    {rejudgeOverrideActive ? 'Mode REJUGER activé' : 'Heat déjà jugé - relance bloquée'}
                  </h4>
                  <p className={`text-xs mt-1 leading-relaxed ${rejudgeOverrideActive ? 'text-emerald-100/80' : 'text-red-100/90'}`}>
                    {rejudgeOverrideActive
                      ? 'Le chef juge a déverrouillé exceptionnellement ce heat. Les scores existants restent conservés; toute nouvelle saisie doit correspondre à une vraie correction terrain.'
                      : rejudgeProtectionReason === 'closed'
                        ? `Ce heat est clôturé et contient ${currentHeatScoreCount} note(s). Le timer et la notation restent bloqués pour éviter de rejuger par accident.`
                        : `Ce heat contient déjà ${currentHeatScoreCount} note(s), mais il n'est plus en cours. Il peut s'agir d'une fermeture incomplète ou d'un retour arrière accidentel.`}
                  </p>

                  {heatRejudgeProtected && (
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-red-200 mb-1.5">
                          Override exceptionnel
                        </label>
                        <input
                          value={rejudgeConfirmText}
                          onChange={(e) => {
                            setRejudgeConfirmText(e.target.value);
                            setRejudgeOverrideError(null);
                          }}
                          placeholder="Tapez REJUGER"
                          className="w-full rounded-lg border border-red-800/60 bg-slate-950 px-3 py-2 text-sm font-black uppercase tracking-widest text-red-100 placeholder:text-red-900/80 focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                        <p className="mt-1.5 text-[11px] text-red-100/70">
                          À utiliser seulement si le heat a été fermé par erreur ou doit réellement être rejugé.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRejudgeOverrideEnable}
                        disabled={rejudgeOverridePending || rejudgeConfirmText.trim().toUpperCase() !== 'REJUGER'}
                        className="rounded-lg border border-red-500/40 bg-red-600 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {rejudgeOverridePending ? 'Déverrouillage...' : 'Déverrouiller'}
                      </button>
                    </div>
                  )}

                  {rejudgeOverrideError && (
                    <div className="mt-3 rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-2 text-xs font-bold text-red-200">
                      {rejudgeOverrideError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {!judgeAssignmentStatus.isReady && (
            <div className="w-full p-4 bg-amber-950/30 border border-amber-850/40 rounded-xl">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-300 uppercase tracking-widest">Démarrage bloqué</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Le heat ne peut pas démarrer tant que ces postes n’ont pas une identité officielle complète: {judgeAssignmentErrorMessage}.
                  </p>
                </div>
              </div>
            </div>
          )}
          {heatStartBlockers.length > 0 && (
            <div className="w-full p-4 bg-red-950/50 border border-red-600/60 rounded-xl shadow-[0_0_30px_rgba(220,38,38,0.20)]">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-300 mt-0.5 mr-3 flex-shrink-0 animate-pulse" />
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-red-200 uppercase tracking-widest">Démarrage bloqué: qualifiés manquants</h4>
                  <p className="text-xs text-red-100/85 mt-1 leading-relaxed">
                    Ce heat dépend d’un ou plusieurs heats précédents qui ne sont pas clôturés ou qui n’ont pas de résultat exploitable.
                    Recalculez les qualifiés ou corrigez le lineup avant de lancer le chronomètre.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {heatStartBlockers.slice(0, 6).map((blocker, index) => (
                      <span
                        key={`${blocker.position ?? index}-${blocker.source_round ?? 'x'}-${blocker.source_heat ?? 'x'}-${blocker.source_position ?? 'x'}`}
                        className="rounded-full border border-red-500/40 bg-red-900/40 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-red-100"
                      >
                        Slot {blocker.position ?? '?'} · {blocker.message ?? 'Qualifié indisponible'}
                      </span>
                    ))}
                  </div>
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
            disabled={heatRejudgeProtected || heatStartDependencyChecking || !judgeAssignmentStatus.isReady}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleTimerResume}
              disabled={!configSaved || timer.isRunning || heatRejudgeProtected || heatStartDependencyChecking || !judgeAssignmentStatus.isReady}
              className="py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-950/40 disabled:text-emerald-700 disabled:border-emerald-900/20 border border-emerald-500/20 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {heatStartDependencyChecking ? 'Vérification...' : 'Reprendre (temps restant)'}
            </button>
            <button
              type="button"
              onClick={handleTimerRestartFull}
              disabled={!configSaved || heatRejudgeProtected || heatStartDependencyChecking || !judgeAssignmentStatus.isReady}
              className="py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-amber-950/40 disabled:text-amber-700 disabled:border-amber-900/20 border border-amber-500/20 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {heatStartDependencyChecking ? 'Vérification...' : 'Recommencer (durée complète)'}
            </button>
          </div>
        </div>
      </details>

      {/* Floating Timer Widget */}
      {(!isTimerOpen && timer.isRunning) && (
        <div className="fixed top-8 right-8 z-[100] neon-card bg-slate-950/90 border border-cyan-500/30 rounded-2xl shadow-2xl p-4 flex flex-col items-center pointer-events-auto backdrop-blur-md transform transition-all">
          <div className="flex items-center space-x-2 w-full justify-between mb-2">
            <Clock className={`w-4 h-4 ${floatingTimeLeft <= 300 ? 'text-rose-500 animate-pulse' : 'text-cyan-400'}`} />
            <h3 className="text-xs font-bebas tracking-widest text-cyan-400">CHRONO PRO</h3>
            <button onClick={() => setIsTimerOpen(true)} className="text-slate-400 hover:text-white transition-colors">
              ▼
            </button>
          </div>
          <div className={`font-bebas tracking-wider text-5xl leading-none ${
            floatingTimeLeft <= 5 
              ? 'text-red-500 animate-pulse drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]' 
              : floatingTimeLeft <= 60 
                ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]' 
                : floatingTimeLeft <= 300 
                  ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.3)]' 
                  : 'text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.3)]'
          }`}>
            {formatMinSec(floatingTimeLeft)}
          </div>
          <button
            onClick={handleTimerPause}
            className="mt-3 w-full bg-rose-600 hover:bg-rose-500 text-white rounded-lg border border-rose-500/20 shadow-lg shadow-rose-950/20 transition-all flex justify-center items-center py-1.5 font-bebas tracking-widest hover:-translate-y-0.5"
          >
            PAUSE
          </button>
        </div>
      )}

      {/* 4. ACCÈS TABLETTES & AFFICHAGES PUBLICS */}
      <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40">
        <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
          <div className="flex items-center space-x-3">
            <Eye className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">4. ACCÈS TABLETTES & AFFICHAGES PUBLICS</h2>
          </div>
          <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-slate-950/20 flex flex-col space-y-6">
          <p className="text-xs text-slate-400">
            Générez et partagez les QR codes ou liens d'accès direct pour l'affichage des scores, le portail partagé des juges, ou la tablette priorité.
          </p>

          {publicDisplayUrl ? (
            <div className="space-y-6">
              {/* 3 Columns Grid for Sharing Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Column 1: Public Live Display */}
                <div className="flex flex-col justify-between p-4 bg-slate-900/60 border border-white/5 rounded-2xl shadow-lg gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-cyan-400">
                      <Eye className="w-5 h-5" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Affichage Public Live</h3>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Diffuse les scores et classements en direct pour le public et les speakers.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleOpenDisplay}
                      className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      Ouvrir l’affichage
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDisplayLink}
                      className="w-full py-2 bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-900 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      {displayLinkCopied ? 'Lien copié ✅' : 'Copier le lien'}
                    </button>
                    <div className="text-[9px] text-slate-500 font-mono break-all bg-slate-950/80 p-2 rounded-lg border border-slate-900/60 select-all">
                      {publicDisplayUrl}
                    </div>
                  </div>

                  {displayQrCode ? (
                    <div className="flex flex-col items-center border border-white/5 bg-slate-950/40 rounded-xl p-3 text-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">QR Code Display</span>
                      <img
                        src={displayQrCode}
                        alt="QR code display public"
                        className="w-32 h-32 rounded-lg border border-white/10 bg-white p-1.5 shadow-sm"
                      />
                    </div>
                  ) : null}
                </div>

                {/* Column 2: Shared Judge Portal */}
                <div className="flex flex-col justify-between p-4 bg-slate-900/60 border border-white/5 rounded-2xl shadow-lg gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-purple-400">
                      <Users className="w-5 h-5" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Portail Unique Juges</h3>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      QR code ou lien unique partagé. Chaque juge peut ensuite sélectionner son poste (J1 à J5).
                    </p>
                  </div>

                  {sharedJudgeAccessUrl ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleCopyJudgeAccessLink}
                        className="w-full py-2 bg-purple-650 hover:bg-purple-550 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                      >
                        {judgeAccessLinkCopied ? 'Lien juges copié ✅' : 'Copier le lien portail'}
                      </button>
                      <div className="text-[9px] text-slate-500 font-mono break-all bg-slate-950/80 p-2 rounded-lg border border-slate-900/60 select-all">
                        {sharedJudgeAccessUrl}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Portail juge indisponible</p>
                  )}

                  {judgeAccessQrCode ? (
                    <div className="flex flex-col items-center border border-white/5 bg-slate-950/40 rounded-xl p-3 text-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">QR Code Portail</span>
                      <img
                        src={judgeAccessQrCode}
                        alt="QR code d'accès juge"
                        className="w-32 h-32 rounded-lg border border-white/10 bg-white p-1.5 shadow-sm"
                      />
                    </div>
                  ) : null}
                </div>

                {/* Column 3: Tablette Priorité */}
                <div className="flex flex-col justify-between p-4 bg-slate-900/60 border border-white/5 rounded-2xl shadow-lg gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-indigo-400">
                      <Clock className="w-5 h-5" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Tablette Priorité</h3>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Lien dédié pour le juge en charge des priorités et du chronomètre sur la plage.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleCopyPriorityLink}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      {priorityLinkCopied ? 'Lien priorité copié ✅' : 'Copier le lien priorité'}
                    </button>
                    <div className="text-[9px] text-slate-500 font-mono break-all bg-slate-950/80 p-2 rounded-lg border border-slate-900/60 select-all">
                      {priorityJudgeUrl}
                    </div>
                  </div>

                  {priorityQrCode ? (
                    <div className="flex flex-col items-center border border-white/5 bg-slate-950/40 rounded-xl p-3 text-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">QR Code Priorité</span>
                      <img
                        src={priorityQrCode}
                        alt="QR code du juge priorité"
                        className="w-32 h-32 rounded-lg border border-white/10 bg-white p-1.5 shadow-sm"
                      />
                    </div>
                  ) : null}
                </div>

              </div>

              {/* Sub-grid: Direct kiosk links */}
              <div className="pt-6 border-t border-slate-850">
                <p className="text-xs font-bold text-slate-350 uppercase tracking-wider mb-4">Liens directs pour tablettes individuelles (J1 à J5)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {["J1", "J2", "J3", "J4", "J5"].map(position => {
                    const kioskUrl = kioskEventId
                      ? `${kioskBaseUrl}/judge?position=${position}&eventId=${kioskEventId}`
                      : `${kioskBaseUrl}/judge?position=${position}`;
                    return (
                      <div key={position} className="flex flex-col justify-between p-3 bg-slate-900/40 rounded-xl border border-white/5 gap-2 shadow-md">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-cyan-600/20 border border-cyan-500/30 rounded-full flex items-center justify-center text-cyan-400 font-black text-[10px]">{position}</div>
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">POSTE {position.replace("J", "")}</span>
                        </div>
                        <input value={kioskUrl} readOnly className="w-full px-2 py-1 text-[8px] font-mono bg-slate-950 border border-slate-850 text-slate-400 rounded select-all" />
                        <button 
                          type="button"
                          onClick={() => { void copyTextSafely(kioskUrl); }} 
                          className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all"
                        >
                          Copier le lien
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          ) : (
            <div className="p-4 rounded-xl border border-rose-800/40 bg-rose-950/20 text-rose-400 text-xs font-semibold text-center uppercase tracking-wide">
              ⚠️ Impossible de générer les accès d'affichage pour le moment. Sauvegardez la configuration ci-dessus pour initialiser.
            </div>
          )}
        </div>
      </details>

      {/* Close Heat */}
      {shouldShowKioskPanel && (
        <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40">
          <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bebas tracking-wider text-slate-100">5. GESTION DU HEAT (CLÔTURE)</h2>
            </div>
            <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
          </summary>
          <div className="p-6 bg-slate-950/20 flex flex-col space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-slate-900/60 border border-white/5 rounded-2xl shadow-lg">
              <div className="flex items-center space-x-3">
                <CheckCircle className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                <div>
                  <h3 className="text-lg font-bold text-slate-200 uppercase tracking-wide">Gestion du Heat</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Heat actuel: {config.competition} - {config.division} - R{config.round} H{config.heatId}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseHeat}
                className="flex items-center justify-center space-x-2 px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow-lg shadow-rose-950/30 font-semibold transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-sm"
              >
                <CheckCircle className="w-5 h-5" />
                <span>Fermer le Heat</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Statistiques des juges */}
            {Object.keys(judgeWorkCount).length > 0 && (
              <div className="p-4 bg-slate-900/40 border border-white/5 rounded-2xl">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Heats consécutifs par juge:</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(judgeWorkCount).map(([judgeId, count]) => (
                    <div key={judgeId} className={`flex items-center justify-between p-3 rounded-xl border ${
                      count >= 4 
                        ? 'bg-rose-950/20 border-rose-800/40 text-rose-300' 
                        : count >= 3 
                          ? 'bg-amber-950/20 border-amber-800/40 text-amber-300' 
                          : 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                    }`}>
                      <span className="text-sm font-semibold">
                        {analyticsJudgeNames.get(judgeId) || config.judgeNames[judgeId] || judgeId}
                      </span>
                      <span className="text-sm font-black font-mono bg-black/40 px-2 py-0.5 rounded-md border border-white/5">{count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-3 font-medium uppercase tracking-wider flex gap-3">
                  <span>🟢 Normal</span>
                  <span>🟠 Attention (3+)</span>
                  <span>🔴 Fatigue (4+)</span>
                </p>
              </div>
            )}

            {judgeAccuracy.length > 0 && (
              <div className="p-4 bg-slate-900/40 border border-white/5 rounded-2xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide">Qualité de jugement</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Référence: médiane des autres juges par vague, plus corrections du chef juge.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-end">
                    <div className="inline-flex rounded-lg border border-slate-800 overflow-hidden bg-slate-950 p-0.5">
                      <button
                        type="button"
                        onClick={() => setAnalyticsScope('heat')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                          analyticsScope === 'heat' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Heat
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnalyticsScope('event')}
                        disabled={!activeEventId}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                          analyticsScope === 'event' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                        } disabled:opacity-30 disabled:cursor-not-allowed`}
                      >
                        Event
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportJudgeAccuracy}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-350 hover:bg-slate-800 rounded-lg transition-all"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                {analyticsLoading && (
                  <p className="text-xs text-cyan-400 animate-pulse mb-3">Chargement de l’analyse événement...</p>
                )}
                <div className="overflow-x-auto rounded-xl border border-white/5 bg-slate-950/60">
                  <table className="min-w-full text-xs font-medium">
                    <thead>
                      <tr className="text-left text-slate-400 border-b border-slate-800 bg-slate-950">
                        <th className="py-3 px-4">Juge</th>
                        <th className="py-3 px-4">Score</th>
                        <th className="py-3 px-4">Vagues</th>
                        <th className="py-3 px-4">Ecart moyen</th>
                        <th className="py-3 px-4">Biais</th>
                        <th className="py-3 px-4">Dans +/-0.5</th>
                        <th className="py-3 px-4">Corrections</th>
                        <th className="py-3 px-4">Delta corr.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {judgeAccuracy.map((row) => (
                        <tr
                          key={row.judgeId}
                          onClick={() => setSelectedJudgeProfileId(row.judgeId)}
                          className={`cursor-pointer transition-all ${
                            selectedJudgeProfileId === row.judgeId ? 'bg-cyan-950/20 text-cyan-200' : 'hover:bg-slate-900/40 text-slate-300'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-bold text-slate-200">{analyticsJudgeNames.get(row.judgeId) || row.judgeId}</td>
                          <td className="py-2.5 px-4">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              row.qualityBand === 'excellent' ? 'bg-emerald-950/60 border border-emerald-800/40 text-emerald-300' :
                              row.qualityBand === 'good' ? 'bg-cyan-950/60 border border-cyan-800/40 text-cyan-300' :
                              row.qualityBand === 'watch' ? 'bg-amber-950/60 border border-amber-800/40 text-amber-300' :
                              'bg-rose-950/60 border border-rose-800/40 text-rose-300'
                            }`}>
                              {row.qualityScore.toFixed(0)}
                            </span>
                          </td>
                          <td className="py-2.5 px-4">{row.scoredWaves}</td>
                          <td className="py-2.5 px-4">{row.meanAbsDeviation.toFixed(2)}</td>
                          <td className={`py-2.5 px-4 font-semibold ${row.bias > 0.15 ? 'text-amber-400' : row.bias < -0.15 ? 'text-cyan-400' : 'text-slate-305'}`}>
                            {row.bias > 0 ? '+' : ''}{row.bias.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-4">{row.withinHalfPointRate.toFixed(0)}%</td>
                          <td className="py-2.5 px-4">{row.overrideCount} ({row.overrideRate.toFixed(0)}%)</td>
                          <td className="py-2.5 px-4">{row.averageOverrideDelta.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedJudgeProfile && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4">
                    <div className="bg-slate-950/60 border border-white/5 rounded-xl p-4 flex flex-col justify-between">
                      <div>
                        <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">Profil juge</p>
                        <h4 className="text-base font-bold text-slate-200">
                          {analyticsJudgeNames.get(selectedJudgeProfile.judgeId) || selectedJudgeProfile.judgeId}
                        </h4>
                        <div className="mt-4 space-y-2 text-xs text-slate-400">
                          <div className="flex justify-between border-b border-slate-900 pb-1"><span>Score qualité</span><strong className="text-cyan-400">{selectedJudgeProfile.qualityScore.toFixed(0)}/100</strong></div>
                          <div className="flex justify-between border-b border-slate-900 pb-1"><span>Ecart moyen</span><strong className="text-slate-300">{selectedJudgeProfile.meanAbsDeviation.toFixed(2)}</strong></div>
                          <div className="flex justify-between border-b border-slate-900 pb-1"><span>Biais</span><strong className={selectedJudgeProfile.bias > 0 ? 'text-amber-400' : 'text-cyan-400'}>{selectedJudgeProfile.bias > 0 ? '+' : ''}{selectedJudgeProfile.bias.toFixed(2)}</strong></div>
                          <div className="flex justify-between border-b border-slate-900 pb-1"><span>Notes proches</span><strong className="text-slate-300">{selectedJudgeProfile.withinHalfPointRate.toFixed(0)}%</strong></div>
                          <div className="flex justify-between"><span>Corrections</span><strong className="text-slate-300">{selectedJudgeProfile.overrideCount}</strong></div>
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-900">
                        <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2">Typologie des corrections</p>
                        <div className="space-y-2 text-xs text-slate-400">
                          <div className="flex justify-between"><span>Correction</span><strong className="text-slate-300">{selectedJudgeOverrideSummary.correction}</strong></div>
                          <div className="flex justify-between"><span>Omission</span><strong className="text-slate-300">{selectedJudgeOverrideSummary.omission}</strong></div>
                          <div className="flex justify-between"><span>Problème</span><strong className="text-slate-300">{selectedJudgeOverrideSummary.probleme}</strong></div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="bg-slate-950/60 border border-white/5 rounded-xl p-4">
                        <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2">Vagues les plus atypiques</p>
                        {selectedJudgeDeviations.length === 0 ? (
                          <p className="text-xs text-slate-500">Pas assez de données comparables pour ce juge sur le scope sélectionné.</p>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                            {selectedJudgeDeviations.map((item) => (
                              <div key={`${item.heatId}-${item.surfer}-${item.waveNumber}`} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2 text-xs">
                                <div>
                                  <div className="font-bold text-slate-200">
                                    {item.surfer} · Vague {item.waveNumber}
                                  </div>
                                  <div className="text-[9px] text-slate-500 font-mono mt-0.5">{item.heatId}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-slate-400 font-mono font-semibold">Juge {item.judgeScore.toFixed(2)} vs panel {item.consensusScore.toFixed(2)}</div>
                                  <div className={`text-[10px] font-bold ${item.delta > 0 ? 'text-amber-400' : 'text-cyan-400'}`}>
                                    {item.delta > 0 ? '+' : ''}{item.delta.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="bg-slate-950/60 border border-white/5 rounded-xl p-4">
                        <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2">Dernières corrections du juge</p>
                        {selectedJudgeOverridesDetailed.length === 0 ? (
                          <p className="text-xs text-slate-500">Aucune correction enregistrée pour ce juge sur le scope sélectionné.</p>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                            {selectedJudgeOverridesDetailed.slice(0, 8).map((log) => (
                              <div key={log.id} className="rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-250">{log.surfer} · Vague {log.wave_number}</span>
                                  <span className="text-[9px] font-bold uppercase bg-slate-900 border border-white/5 px-1.5 py-0.5 rounded text-slate-400">{reasonLabels[log.reason]}</span>
                                </div>
                                <div className="mt-1 text-[9px] uppercase tracking-wide text-slate-500">
                                  {log.contextLabel}
                                </div>
                                <div className="mt-1 text-slate-300 font-mono">
                                  {log.previous_score !== null ? `${log.previous_score.toFixed(2)} → ` : ''}
                                  {log.new_score.toFixed(2)}
                                </div>
                                {log.comment && (
                                  <div className="mt-1 text-[10px] italic text-slate-500">{log.comment}</div>
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
      <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40">
        <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
          <div className="flex items-center space-x-3">
            <Settings className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">5. PARAMÈTRES AVANCÉS</h2>
          </div>
          <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-slate-950/20 space-y-6 flex flex-col">
          {/* JUDGES SECTION */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bebas tracking-wide text-slate-200 flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-400" />
                Juges / Officiels
              </h3>
            </div>
            {officialJudgeStatus && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                officialJudgeStatus.type === 'success'
                  ? 'border-emerald-850/40 bg-emerald-950/20 text-emerald-400'
                  : 'border-rose-850/40 bg-rose-950/20 text-rose-400'
              }`}>
                {officialJudgeStatus.message}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {config.judges.map((judgeId, index) => (
                <div key={judgeId} className="bg-slate-900/60 border border-white/5 p-4 rounded-2xl shadow-lg flex flex-col gap-3">
                  {(() => {
                    const assignedIdentityId = resolveAssignedJudgeIdentity(judgeId);
                    const assignedOfficialJudge = availableOfficialJudges.find((judge) => judge.id === assignedIdentityId);
                    const isOfficialAssigned = Boolean(assignedIdentityId);
                    const manualJudgeName = (config.judgeNames[judgeId] || '').trim();
                    const canCreateOfficial = !isOfficialAssigned && manualJudgeName.length > 0;
                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Juge #{index + 1}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveJudge(judgeId)}
                            className="p-1.5 text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors border border-transparent hover:border-rose-900/30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <select
                            value={assignedIdentityId}
                            onChange={(e) => handleJudgeIdentityChange(judgeId, e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-xs"
                          >
                            <option value="" className="bg-slate-950">Sélectionner un juge officiel</option>
                            {availableOfficialJudges.map((judge) => (
                              <option key={judge.id} value={judge.id} className="bg-slate-950">
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
                            className={`w-full px-3 py-2 bg-slate-950 border text-xs font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 ${isOfficialAssigned ? 'border-emerald-850/40 text-emerald-400 bg-emerald-950/10 cursor-not-allowed' : 'border-slate-800'}`}
                          />
                          <input
                            type="email"
                            value={config.judgeEmails?.[judgeId] || ''}
                            onChange={(e) => handleJudgeEmailChange(judgeId, e.target.value)}
                            placeholder="Email (optionnel)"
                            readOnly={isOfficialAssigned}
                            className={`w-full px-3 py-1.5 border text-[10px] font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 ${isOfficialAssigned ? 'bg-emerald-950/10 border-emerald-850/40 text-emerald-400 cursor-not-allowed' : 'bg-slate-950 border-slate-800'}`}
                          />
                          <p className="text-[9px] text-slate-450 font-mono">
                            {isOfficialAssigned
                              ? `Officiel lié: ${assignedOfficialJudge?.name || config.judgeNames[judgeId] || judgeId}`
                              : `Aucune identité officielle liée à ${judgeId}`}
                          </p>
                          {!isOfficialAssigned && (
                            <button
                              type="button"
                              onClick={() => handleCreateOfficialJudge(judgeId)}
                              disabled={!canCreateOfficial || creatingOfficialJudgeFor === judgeId}
                              className={`w-full rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
                                canCreateOfficial && creatingOfficialJudgeFor !== judgeId
                                  ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                                  : 'bg-slate-900 border border-slate-800 text-slate-505 cursor-not-allowed'
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
                type="button"
                onClick={handleAddJudge}
                className="p-6 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-cyan-500 hover:text-cyan-400 hover:bg-slate-900/40 transition-all group"
              >
                <PlusCircle className="w-8 h-8 group-hover:scale-110 transition-transform" />
                <span className="font-bebas tracking-widest text-lg">Ajouter un Juge</span>
              </button>
            </div>
          </div>

          {/* SURFERS SECTION */}
          <div className="pt-6 border-t border-slate-850">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bebas tracking-wide text-slate-200 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-cyan-400" />
                Surfeurs par Couleur de Lycra
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {(['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'] as const).map((color) => {
                const isAssigned = config.surfers.includes(color);
                return (
                  <div key={color} className={`bg-slate-900/60 border border-white/5 rounded-2xl overflow-hidden shadow-lg transition-all ${!isAssigned && 'opacity-40 grayscale'}`}>
                    <div className={`px-4 py-2 flex items-center justify-between font-bold text-[10px] uppercase tracking-widest ${
                      color === 'ROUGE' ? 'bg-red-600 text-white' :
                      color === 'BLANC' ? 'bg-slate-100 text-slate-900' :
                      color === 'JAUNE' ? 'bg-yellow-400 text-slate-900' :
                      color === 'BLEU' ? 'bg-blue-600 text-white' :
                      color === 'VERT' ? 'bg-green-600 text-white' :
                      'bg-slate-950 text-white border-b border-white/5'
                    }`}>
                      <span>{color}</span>
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...config.surfers, color]
                            : config.surfers.filter(s => s !== color);
                          handleConfigChange('surfers', next);
                        }}
                        className="w-3.5 h-3.5 rounded border-slate-850 text-cyan-600 focus:ring-0 cursor-pointer"
                      />
                    </div>
                    <div className="p-3 space-y-2">
                      <input
                        type="text"
                        value={config.surferNames?.[color] || ''}
                        onChange={(e) => handleSurferNameChange(color, e.target.value)}
                        placeholder="Nom"
                        disabled={!isAssigned}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                      />
                      <input
                        type="text"
                        value={config.surferCountries?.[color] || ''}
                        onChange={(e) => handleSurferCountryChange(color, e.target.value)}
                        placeholder="Pays"
                        disabled={!isAssigned}
                        className="w-full px-2.5 py-1 bg-slate-950 border border-slate-850 text-slate-450 rounded-lg text-[10px] focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-850">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h3 className="text-lg font-bebas tracking-wide text-slate-200 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-cyan-400" />
                  Lineup officiel du heat
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Override chef juge: remplace ou ajoute le surfeur officiel d'une couleur sans toucher aux scores déjà saisis.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLineupRefreshToken((value) => value + 1)}
                disabled={lineupOverrideLoading}
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-350 hover:bg-slate-850 disabled:opacity-50 transition-all self-end"
              >
                <RotateCcw className="w-3.5 h-3.5 animate-spin-slow" />
                Recharger lineup
              </button>
            </div>

            {lineupOverrideStatus && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-xs ${
                lineupOverrideStatus.type === 'success'
                  ? 'border-emerald-850/40 bg-emerald-950/20 text-emerald-400'
                  : lineupOverrideStatus.type === 'error'
                    ? 'border-rose-850/40 bg-rose-950/20 text-rose-400'
                    : 'border-cyan-850/40 bg-cyan-950/20 text-cyan-400'
              }`}>
                {lineupOverrideStatus.message}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {lineupDisplayRows.map(({ color, position, row }) => {
                const draft = lineupDrafts[position] || {
                  participantId: row.participant_id ? String(row.participant_id) : '',
                  manualName: row.participant?.name || '',
                  country: row.participant?.country || '',
                  reason: '',
                };
                const currentName = row.participant?.name || config.surferNames?.[color] || 'Slot vide';
                const currentCountry = row.participant?.country || config.surferCountries?.[color] || '';
                const pending = lineupPendingPosition === position;

                return (
                  <div key={`${position}-${color}`} className="rounded-2xl border border-white/5 bg-slate-900/60 p-4 shadow-lg flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Position {position}</p>
                        <h4 className="text-base font-bebas tracking-wide text-slate-300">{color}</h4>
                        <p className="text-sm font-bold text-slate-200">{currentName}</p>
                        {currentCountry && <p className="text-xs text-slate-400 mt-0.5">{currentCountry}</p>}
                      </div>
                      <span className="rounded-full bg-amber-950/20 border border-amber-900/30 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
                        Source officielle
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      <select
                        value={draft.participantId}
                        onChange={(event) => {
                          const nextParticipantId = event.target.value;
                          const participant = lineupParticipantOptions.find((item) => String(item.id) === nextParticipantId);
                          updateLineupDraft(position, {
                            participantId: nextParticipantId,
                            manualName: participant?.name || '',
                            country: participant?.country || '',
                          });
                        }}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-slate-250 rounded-lg text-xs"
                      >
                        <option value="" className="bg-slate-950">Choisir dans les inscrits...</option>
                        {lineupParticipantOptions.map((participant) => (
                          <option key={participant.id} value={participant.id} className="bg-slate-950">
                            #{participant.seed} · {participant.name}{participant.country ? ` · ${participant.country}` : ''}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={draft.manualName}
                          onChange={(event) => updateLineupDraft(position, { participantId: '', manualName: event.target.value })}
                          placeholder="Ou nouveau nom"
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                        <input
                          type="text"
                          value={draft.country}
                          onChange={(event) => updateLineupDraft(position, { country: event.target.value })}
                          placeholder="Pays / Club"
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <input
                        type="text"
                        value={draft.reason}
                        onChange={(event) => updateLineupDraft(position, { reason: event.target.value })}
                        placeholder="Motif optionnel..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-850 text-slate-400 rounded-lg text-[10px] focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />

                      <button
                        type="button"
                        onClick={() => handleApplyLineupOverride(position, color)}
                        disabled={lineupOverrideLoading}
                        className={`w-full rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors ${
                          pending
                            ? 'bg-amber-600 animate-pulse'
                            : 'bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-900 disabled:text-slate-505 disabled:border-slate-850'
                        }`}
                      >
                        {pending ? 'Application...' : 'Appliquer modification'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-850 flex flex-wrap gap-3">
            <button
              onClick={onReloadData}
              className="flex items-center space-x-2 px-4 py-2.5 border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-bold transition-all"
            >
              <RotateCcw className="w-4 h-4 text-cyan-400" />
              <span>Recharger</span>
            </button>

            <button
              onClick={handleResetAllData}
              className="flex items-center space-x-2 px-4 py-2.5 bg-rose-900/60 hover:bg-rose-800/60 border border-rose-800/40 text-rose-305 rounded-lg font-bebas tracking-widest text-base transition-all"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>RESET NUCLÉAIRE</span>
            </button>

            <button
              onClick={handleExportPdf}
              className="flex items-center space-x-2 px-4 py-2.5 bg-indigo-900/40 hover:bg-indigo-800/40 border border-indigo-800/40 text-indigo-300 rounded-lg text-xs font-bold transition-all"
            >
              <FileText className="w-4 h-4 text-indigo-400" />
              <span>Export PDF Heat</span>
            </button>

            <button
              onClick={handleExportEventPdf}
              disabled={eventPdfPending}
              className={`flex items-center space-x-2 px-4 py-2.5 border rounded-lg text-xs font-bold transition-all ${
                eventPdfPending
                  ? 'bg-purple-950/20 border-purple-900/20 text-purple-650 cursor-not-allowed opacity-50'
                  : 'bg-purple-900/40 hover:bg-purple-800/40 border-purple-800/40 text-purple-300'
              }`}
            >
              <FileText className="w-4 h-4 text-purple-400" />
              <span>{eventPdfPending ? 'Export évènement…' : 'Export complet (PDF)'}</span>
            </button>

            <button
              onClick={handleExportFinalRankingPdf}
              disabled={rankingPdfPending}
              className={`flex items-center space-x-2 px-4 py-2.5 border rounded-lg text-xs font-bold transition-all ${
                rankingPdfPending
                  ? 'bg-emerald-950/20 border-emerald-900/20 text-emerald-650 cursor-not-allowed opacity-50'
                  : 'bg-emerald-900/40 hover:bg-emerald-800/40 border-emerald-800/40 text-emerald-300'
              }`}
            >
              <Trophy className="w-4 h-4 text-emerald-400" />
              <span>{rankingPdfPending ? 'Génération ranking…' : 'Classement Final (PDF)'}</span>
            </button>

            <button
              onClick={handleRebuildDivisionQualifiers}
              disabled={rebuildPending || !configSaved}
              className={`flex items-center space-x-2 px-4 py-2.5 border rounded-lg text-xs font-bold transition-all ${
                rebuildPending || !configSaved
                  ? 'bg-amber-950/20 border-amber-900/20 text-amber-650 cursor-not-allowed opacity-50'
                  : 'bg-amber-900/40 hover:bg-amber-800/40 border-amber-800/40 text-amber-305'
              }`}
            >
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span>{rebuildPending ? 'Recalcul en cours…' : 'Recalculer qualifiés (division)'}</span>
            </button>

            <button
              onClick={exportData}
              className="flex items-center space-x-2 px-4 py-2.5 bg-emerald-900/40 hover:bg-emerald-800/40 border border-emerald-800/40 text-emerald-300 rounded-lg text-xs font-bold transition-all"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Export JSON</span>
            </button>
          </div>

          <div className="pt-6 border-t border-slate-850 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Code Secret (PIN) pour les Juges
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={config.secretKey || ''}
                  onChange={(e) => handleConfigChange('secretKey', e.target.value)}
                  placeholder="Ex: 1234"
                  className="w-full md:w-1/2 px-3 py-2 bg-slate-950 border border-slate-800 text-slate-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <span className="text-[10px] text-slate-500 font-medium">
                  Code simple permettant aux juges de se connecter sans email.
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Code Admin Hors-ligne (LAN)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={offlineAdminPin}
                  onChange={(e) => setOfflineAdminPin(e.target.value)}
                  placeholder="Ex: 7890"
                  className="w-full md:w-1/2 px-3 py-2 bg-slate-950 border border-slate-800 text-slate-100 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <button
                  type="button"
                  onClick={handleSaveOfflineAdminPin}
                  className="px-4 py-2 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-lg transition-all"
                >
                  Enregistrer
                </button>
              </div>
              <p className="text-[10px] text-slate-550 font-medium mt-1">
                Permet d’accéder à /admin sans magic link quand Internet est indisponible.
              </p>
            </div>
          </div>
        </div>
      </details>

      {/* Override Chef Juge */}
      <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40" open={showOverridePanel}>
        <summary
          className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5"
          onClick={(e) => {
            e.preventDefault();
            setShowOverridePanel(!showOverridePanel);
          }}
        >
          <div className="flex items-center space-x-3">
            <ClipboardCheck className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">6. CORRECTION DE NOTES</h2>
          </div>
          <div className="flex items-center space-x-4">
            {!configSaved && <span className="text-[10px] text-rose-450 border border-rose-900/40 bg-rose-950/20 font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">Non sauvegardé</span>}
            <span className={`text-slate-400 transition-transform opacity-70 ${showOverridePanel ? 'rotate-180' : ''}`}>▼</span>
          </div>
        </summary>

        {showOverridePanel && (
          <div className="p-6 bg-slate-950/20 flex flex-col space-y-4">
            <form className="space-y-4" onSubmit={handleOverrideSubmit}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCorrectionMode('score')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    correctionMode === 'score' 
                      ? 'bg-amber-600 border-amber-500/20 text-white' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-205'
                  }`}
                >
                  Mode note
                </button>
                <button
                  type="button"
                  onClick={() => setCorrectionMode('interference')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    correctionMode === 'interference' 
                      ? 'bg-amber-600 border-amber-500/20 text-white' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-205'
                  }`}
                >
                  Mode interférence
                </button>
              </div>

              {/* Juge selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Juge</label>
                  <select
                    value={selectedJudge}
                    onChange={(e) => { setSelectedJudge(e.target.value); setOverrideStatus(null); }}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    required
                  >
                    <option value="" className="bg-slate-950">Sélectionner un juge</option>
                    {config.judges.map((judgeId) => (
                      <option key={judgeId} value={judgeId} className="bg-slate-950">
                        {config.judgeNames[judgeId] || judgeId}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Surfer selection */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Surfeur</label>
                  <select
                    value={selectedSurfer}
                    onChange={(e) => { setSelectedSurfer(e.target.value); setSelectedWave(''); setOverrideStatus(null); }}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    required
                  >
                    <option value="" className="bg-slate-950">Sélectionner un surfeur</option>
                    {config.surfers.map((surfer) => (
                      <option key={surfer} value={surfer} className="bg-slate-950">{surfer}</option>
                    ))}
                  </select>
                </div>

                {/* Wave selection */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Vague</label>
                  <select
                    value={selectedWave}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedWave(value ? Number(value) : '');
                      setOverrideStatus(null);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    required
                  >
                    <option value="" className="bg-slate-950">Sélectionner une vague</option>
                    {surferScoredWaves.map((wave) => (
                      <option key={wave} value={wave} className="bg-slate-950">Vague {wave}</option>
                    ))}
                  </select>
                  {selectedSurfer && surferScoredWaves.length === 0 ? (
                    <p className="text-[10px] text-amber-400 mt-1 font-medium animate-pulse">
                      Aucune vague notée trouvée pour ce surfeur sur ce heat.
                    </p>
                  ) : (
                    <p className="text-[9px] text-slate-500 mt-1 font-medium uppercase tracking-wider">
                      Seules les vagues notées pour ce surfeur sont affichées.
                    </p>
                  )}
                </div>

                {correctionMode === 'score' ? (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Nouvelle note</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={scoreInput}
                      onChange={(e) => { setScoreInput(sanitizeScoreInput(e.target.value)); setOverrideStatus(null); }}
                      placeholder="0.0"
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono font-bold"
                      required
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Type d’interférence</label>
                    <select
                      value={interferenceType}
                      onChange={(e) => setInterferenceType(e.target.value as InterferenceType)}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="INT1" className="bg-slate-950">Interférence #1 (B/2)</option>
                      <option value="INT2" className="bg-slate-950">Interférence #2 (B=0)</option>
                    </select>
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-350 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={headJudgeOverride}
                        onChange={(e) => setHeadJudgeOverride(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-850 text-cyan-600 bg-slate-950 focus:ring-0 cursor-pointer"
                      />
                      Arbitrage Head Judge
                    </label>
                  </div>
                )}
              </div>

              {currentScore && (
                <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-300 flex items-center space-x-2 shadow-lg">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>
                    Note actuelle : <strong className="text-amber-200 font-bold">{currentScore.score.toFixed(2)}</strong> donnée par <span className="underline">{currentScore.judge_name}</span> pour <span className="font-bold text-cyan-400">{currentScore.surfer}</span> (Vague {currentScore.wave_number})
                  </span>
                </div>
              )}

              {correctionMode === 'score' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Motif</label>
                    <select
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      {Object.keys(reasonLabels).map((r) => (
                        <option key={r} value={r}>{reasonLabels[r as keyof typeof reasonLabels]}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Commentaire</label>
                    <input
                      type="text"
                      value={overrideComment}
                      onChange={(e) => setOverrideComment(e.target.value)}
                      placeholder="Optionnel"
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                </div>
              )}

              {correctionMode === 'score' && currentScore && (
                <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-4 space-y-3 shadow-lg">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    Déplacer une note (mauvais surfeur / mauvaise vague)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={moveTargetSurfer}
                      onChange={(e) => setMoveTargetSurfer(e.target.value)}
                      className="w-full bg-slate-950 border border-indigo-950 text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="" className="bg-slate-950">Surfeur destination</option>
                      {config.surfers.map((surfer) => (
                        <option key={surfer} value={surfer} className="bg-slate-950">{surfer}</option>
                      ))}
                    </select>
                    <select
                      value={moveTargetWave}
                      onChange={(e) => setMoveTargetWave(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-indigo-950 text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="" className="bg-slate-950">Vague destination</option>
                      {Array.from({ length: config.waves }, (_, i) => i + 1).map((wave) => (
                        <option key={wave} value={wave} className="bg-slate-950">Vague {wave}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleMoveScore}
                    disabled={overridePending || !configSaved}
                    className={`px-4 py-2 border rounded-lg text-xs font-bold uppercase tracking-wider text-white transition-all ${
                      overridePending 
                        ? 'bg-indigo-950/20 border-indigo-900/20 text-indigo-750 cursor-wait' 
                        : 'bg-indigo-900/40 hover:bg-indigo-800/40 border-indigo-800/40 text-indigo-300'
                    } ${!configSaved ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Déplacer la note sélectionnée
                  </button>
                </div>
              )}

              {overrideStatus && (
                <div className={`rounded-xl px-4 py-3 text-xs font-medium border ${
                  overrideStatus.type === 'success'
                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-800/40'
                    : 'bg-rose-950/20 text-rose-400 border-rose-800/40'
                }`}>
                  {overrideStatus.message}
                </div>
              )}

              {correctionMode === 'score' ? (
                <button
                  type="submit"
                  disabled={overridePending || !configSaved}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-white transition-all ${
                    overridePending 
                      ? 'bg-amber-950/20 border-amber-900/20 text-amber-750 cursor-wait' 
                      : 'bg-amber-600 hover:bg-amber-500 border border-amber-500/20 shadow-md shadow-amber-950/30'
                  } ${!configSaved ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {overridePending ? 'Application…' : 'Appliquer la correction'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleInterferenceSubmit}
                  disabled={overridePending || !configSaved}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-white transition-all ${
                    overridePending 
                      ? 'bg-amber-950/20 border-amber-900/20 text-amber-750 cursor-wait' 
                      : 'bg-amber-600 hover:bg-amber-500 border border-amber-500/20 shadow-md shadow-amber-950/30'
                  } ${!configSaved ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {overridePending ? 'Application…' : 'Poser l’interférence'}
                </button>
              )}
            </form>
          </div>
        )}
      </details>

      {/* Historique des corrections */}
      <details className="group neon-card rounded-2xl shadow-2xl border border-white/5 overflow-hidden bg-slate-950/40">
        <summary className="bg-slate-950/80 hover:bg-slate-900/60 p-4 flex justify-between items-center cursor-pointer list-none select-none border-b border-white/5">
          <div className="flex items-center space-x-3">
            <RotateCcw className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bebas tracking-wider text-slate-100">8. HISTORIQUE DES CORRECTIONS</h2>
          </div>
          <span className="text-slate-400 group-open:rotate-180 transition-transform opacity-70">▼</span>
        </summary>
        <div className="p-6 bg-slate-950/20 flex flex-col space-y-4">
          {effectiveOverrideLogs.length === 0 ? (
            <p className="text-xs text-slate-500 font-medium">Aucune correction enregistrée pour ce heat.</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {effectiveOverrideLogs.map(log => (
                <div key={log.id} className="border border-white/5 rounded-2xl px-4 py-3 text-xs bg-slate-900/40 shadow-lg flex flex-col justify-between gap-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-200 text-sm">{config.judgeNames[log.judge_id] || log.judge_name}</span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">{new Date(log.created_at).toLocaleTimeString('fr-FR')}</span>
                  </div>
                  <div className="mt-1 text-slate-350">
                    Surfeur: <span className="font-bold text-cyan-400">{log.surfer}</span> · Vague: <span className="font-bold font-mono text-slate-200">#{log.wave_number}</span>
                  </div>
                  <div className="mt-1 text-slate-300 font-medium">
                    Motif: <span className="font-bold text-amber-400">{reasonLabels[log.reason]}</span> — {log.previous_score !== null ? `ancien ${log.previous_score.toFixed(2)} → ` : ''}<span className="font-black font-mono text-emerald-400 text-sm">{log.new_score.toFixed(2)}</span>
                  </div>
                  {log.comment && (
                    <div className="mt-2 text-slate-450 italic bg-black/20 p-2 rounded-lg border border-white/5 text-[10px]">{log.comment}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
};

export default AdminInterface;
