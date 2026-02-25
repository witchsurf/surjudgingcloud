import { AlertTriangle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Settings, Clock, Users, Download, RotateCcw, Trash2, Database, Wifi, WifiOff, CheckCircle, ArrowRight, ClipboardCheck, AlertCircle, Info as InfoIcon, Eye, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import HeatTimer from './HeatTimer';
import type { AppConfig, HeatTimer as HeatTimerType, Score, ScoreOverrideLog, OverrideReason, InterferenceType } from '../types';
import { validateScore } from '../utils/scoring';
import { calculateSurferStats } from '../utils/scoring';
import { computeEffectiveInterferences } from '../utils/interference';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { SURFER_COLORS as SURFER_COLOR_MAP } from '../utils/constants';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { exportHeatScorecardPdf, exportFullCompetitionPDF } from '../utils/pdfExport';
import { fetchEventIdByName, fetchOrderedHeatSequence, fetchAllEventHeats, fetchAllEventCategories, fetchAllScoresForEvent, fetchAllInterferenceCallsForEvent, fetchHeatScores, fetchHeatEntriesWithParticipants, fetchHeatSlotMappings, fetchInterferenceCalls, replaceHeatEntries, ensureEventExists, upsertInterferenceCall } from '../api/supabaseClient';
import { supabase, isSupabaseConfigured, getSupabaseConfig, getSupabaseMode, setSupabaseMode, isCloudLocked, setCloudLocked } from '../lib/supabase';
import { isPrivateHostname } from '../utils/network';

const ACTIVE_EVENT_STORAGE_KEY = 'surfJudgingActiveEventId';


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
  onScoreOverride: (input: {
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
  }) => Promise<ScoreOverrideLog | undefined>;
  onRealtimeTimerStart?: (heatId: string, config: AppConfig, duration: number) => Promise<void>;
  onRealtimeTimerPause?: (heatId: string, remainingDuration?: number) => Promise<void>;
  onRealtimeTimerReset?: (heatId: string, duration: number) => Promise<void>;
  availableDivisions?: string[];
  loadState?: 'loading' | 'loaded' | 'empty' | 'error';
  loadError?: string | null;
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
  onScoreOverride,
  onRealtimeTimerStart,
  onRealtimeTimerPause,
  onRealtimeTimerReset,
  availableDivisions = [],
  loadState = 'loaded',
  loadError = null,
  loadedFromDb = false,
  activeEventId,
  onReconnectToDb
}) => {
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [selectedJudge, setSelectedJudge] = useState('');
  const [selectedSurfer, setSelectedSurfer] = useState('');
  const [cloudLocked, setCloudLockedState] = useState(isCloudLocked());
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
  const [divisionHeatSequence, setDivisionHeatSequence] = useState<Array<{ round: number; heat_number: number }>>([]);
  const [displayLinkCopied, setDisplayLinkCopied] = useState(false);
  const [eventPdfPending, setEventPdfPending] = useState(false);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [supabaseMode, setSupabaseModeState] = useState(getSupabaseMode());
  const supabaseConfig = getSupabaseConfig();
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

  const currentScore = React.useMemo(() => {
    if (!selectedJudge || !selectedSurfer || !selectedWave) return undefined;
    const selectedSurferKey = normalizeJerseyLabel(selectedSurfer);
    return scores
      .filter(score =>
        ensureHeatId(score.heat_id) === heatId &&
        score.judge_id === selectedJudge &&
        normalizeJerseyLabel(score.surfer) === selectedSurferKey &&
        score.wave_number === Number(selectedWave)
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }, [scores, heatId, selectedJudge, selectedSurfer, selectedWave]);

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

    const targetAlreadyUsed = scores.some(
      (score) =>
        ensureHeatId(score.heat_id) === heatId &&
        score.judge_id === selectedJudge &&
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
        heatStatus: timer.isRunning ? 'running' : timer.startTime ? 'paused' : 'waiting',
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
  }, [config, configSaved, timer]);

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

  const handleSupabaseModeChange = (mode: 'local' | 'cloud' | null) => {
    if (cloudLocked && mode === 'cloud') {
      alert('Mode Cloud bloqué. Désactivez le verrouillage LAN pour revenir au cloud.');
      return;
    }
    setSupabaseMode(mode);
    setSupabaseModeState(mode);
    window.location.reload();
  };

  const handleCloudLockToggle = (locked: boolean) => {
    setCloudLocked(locked);
    setCloudLockedState(locked);
    if (locked) {
      setSupabaseMode('local');
      setSupabaseModeState('local');
    }
    window.location.reload();
  };

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
          setDivisionHeatSequence(sequence.map((row) => ({ round: row.round, heat_number: row.heat_number })));
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
  }, [activeEventId, config.division]);

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

  const roundOptions = React.useMemo(() => {
    if (!divisionHeatSequence.length) return [config.round];
    return Array.from(new Set(divisionHeatSequence.map((row) => row.round))).sort((a, b) => a - b);
  }, [divisionHeatSequence, config.round]);

  const heatOptionsForRound = React.useMemo(() => {
    if (!divisionHeatSequence.length) return [config.heatId];
    const options = divisionHeatSequence
      .filter((row) => row.round === config.round)
      .map((row) => row.heat_number);
    const unique = Array.from(new Set(options)).sort((a, b) => a - b);
    return unique.length ? unique : [config.heatId];
  }, [divisionHeatSequence, config.round, config.heatId]);

  useEffect(() => {
    if (!effectiveDivisionOptions.length) return;
    const currentIsValid = effectiveDivisionOptions.some(
      (division) => division.toLowerCase() === config.division.toLowerCase()
    );
    if (!currentIsValid) {
      onConfigChange({ ...config, division: effectiveDivisionOptions[0] });
    }
  }, [effectiveDivisionOptions, config, onConfigChange]);

  useEffect(() => {
    if (!roundOptions.length) return;

    const firstRound = roundOptions[0];
    const nextRound = roundOptions.includes(config.round) ? config.round : firstRound;

    const heatsInRound = divisionHeatSequence
      .filter((row) => row.round === nextRound)
      .map((row) => row.heat_number);
    const uniqueHeats = Array.from(new Set(heatsInRound)).sort((a, b) => a - b);
    const firstHeat = uniqueHeats[0] ?? config.heatId;
    const nextHeatId = uniqueHeats.includes(config.heatId) && nextRound === config.round
      ? config.heatId
      : firstHeat;

    if (nextRound !== config.round || nextHeatId !== config.heatId) {
      onConfigChange({ ...config, round: nextRound, heatId: nextHeatId });
    }
  }, [roundOptions, divisionHeatSequence, config, onConfigChange]);

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
    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date(),
      duration: timer.duration
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerStart && configSaved) {
      onRealtimeTimerStart(heatId, config, newTimer.duration)
        .then(() => {
          console.log('🚀 ADMIN: Timer START publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer START en mode local uniquement', error instanceof Error ? error.message : error);
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

  const handleTimerRestartFull = () => {
    if (!configSaved) return;
    const fullDuration = Math.max(1, plannedTimerDuration || timer.duration || 20);
    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date(),
      duration: fullDuration
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));

    if (onRealtimeTimerStart) {
      onRealtimeTimerStart(heatId, config, fullDuration)
        .then(() => {
          console.log('🔁 ADMIN: Timer RESTART publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer RESTART en mode local uniquement', error instanceof Error ? error.message : error);
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

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerPause && configSaved) {
      onRealtimeTimerPause(heatId, remainingDuration)
        .then(() => {
          console.log('⏸️ ADMIN: Timer PAUSE publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer PAUSE en mode local uniquement', error instanceof Error ? error.message : error);
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

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerReset && configSaved) {
      onRealtimeTimerReset(heatId, newTimer.duration)
        .then(() => {
          console.log('🔄 ADMIN: Timer RESET publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer RESET en mode local uniquement', error instanceof Error ? error.message : error);
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

    const exactHeatScores = (scores || []).filter(
      (score) => ensureHeatId(score.heat_id) === heatId && Number(score.score) > 0
    );

    const fallbackByMetaScores = (scores || []).filter((score) => {
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

    // Warning if no scores, but allow to proceed with confirmation
    if (!canCloseWithoutWarning) {
      const forceClose = confirm(
        '⚠️ ATTENTION: Aucune vague complète enregistrée!\n\n' +
        'Ce heat sera fermé SANS RÉSULTATS.\n' +
        '(En compétition réelle, ce heat devrait être rejoué.)\n\n' +
        'Voulez-vous quand même passer au heat suivant?'
      );
      if (!forceClose) {
        return;
      }
    } else {
      // Normal confirmation
      if (!confirm(`Fermer le Heat ${config.heatId} et passer au suivant ?`)) {
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
    // Récupérer toutes les vagues notées pour ce surfeur (tous juges confondus)
    const waves = new Set(scores
      .filter(s => normalizeJerseyLabel(s.surfer) === selectedSurferKey && ensureHeatId(s.heat_id) === heatId)
      .map(s => s.wave_number)
    );
    return Array.from(waves).sort((a, b) => a - b);
  }, [scores, selectedSurfer, heatId]);

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
    const eventIdRaw = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY) : null;
    const eventId = eventIdRaw ? Number(eventIdRaw) : NaN;
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
      const allScores = await fetchAllScoresForEvent(eventId);
      const allInterferenceCalls = await fetchAllInterferenceCallsForEvent(eventId);

      // Get event details (organizer, date) if available
      let organizer: string | undefined;
      let eventDate: string | undefined;

      if (supabase) {
        const { data: eventData } = await supabase
          .from('events')
          .select('organizer, start_date')
          .eq('id', eventId)
          .single();

        if (eventData) {
          organizer = eventData.organizer ?? undefined;
          eventDate = eventData.start_date
            ? new Date(eventData.start_date).toLocaleDateString('fr-FR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
            : undefined;
        }
      }

      // Export complete competition PDF
      exportFullCompetitionPDF({
        eventName: config.competition || 'Compétition',
        organizer,
        date: eventDate,
        divisions: allDivisions,
        scores: allScores,
        interferenceCalls: allInterferenceCalls,
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
      {/* Statut de la base de données */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Database className="w-5 h-5 text-gray-600" />
            <span className="font-medium text-gray-900">Statut de la base de données</span>
          </div>
          <div className="flex items-center space-x-2">
            {dbStatus === 'checking' && (
              <>
                <Wifi className="w-4 h-4 text-yellow-500 animate-pulse" />
                <span className="text-sm text-yellow-600">Vérification...</span>
              </>
            )}
            {dbStatus === 'connected' && (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600">Connecté</span>
              </>
            )}
            {dbStatus === 'disconnected' && (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">Déconnecté</span>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-700">Mode Supabase:</span>
            <button
              type="button"
              onClick={() => handleSupabaseModeChange(null)}
              className={`px-2.5 py-1 rounded border text-xs ${!supabaseMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => handleSupabaseModeChange('local')}
              className={`px-2.5 py-1 rounded border text-xs ${supabaseMode === 'local' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
            >
              Local (LAN)
            </button>
            <button
              type="button"
              onClick={() => handleSupabaseModeChange('cloud')}
              className={`px-2.5 py-1 rounded border text-xs ${supabaseMode === 'cloud' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
            >
              Cloud (Internet)
            </button>
            <button
              type="button"
              onClick={() => handleCloudLockToggle(!cloudLocked)}
              className={`px-2.5 py-1 rounded border text-xs ${cloudLocked ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-700 border-gray-300'}`}
            >
              {cloudLocked ? '🔒 Cloud bloqué (LAN)' : 'Basculer LAN (bloque cloud)'}
            </button>
          </div>
          <div className="text-xs text-gray-600">
            URL active : <span className="font-mono">{supabaseConfig.supabaseUrl || '—'}</span>
          </div>
          {cloudLocked && (
            <div className="text-xs text-amber-700">
              Mode LAN verrouillé : le cloud est désactivé jusqu’à déverrouillage.
            </div>
          )}
        </div>
      </div>

      {/* Configuration principale */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="absolute top-4 right-4">
          <button
            type="button"
            onClick={handleOpenDisplay}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Affichage
          </button>
        </div>
        <div className="flex items-center space-x-3 mb-6">
          <Settings className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-900">Configuration de la Compétition</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => navigate('/my-events')}
              className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            >
              ← Mes événements
            </button>
            <button
              onClick={() => {
                if (confirm('🧹 Nettoyer toutes les données et recommencer ?')) {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }
              }}
              className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
            >
              🧹 Reset Complet
            </button>
          </div>
        </div>

        {loadState === 'loading' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <RotateCcw className="h-4 w-4 animate-spin" />
            <span>Chargement de la configuration en cours…</span>
          </div>
        )}

        {loadState === 'loaded' && loadedFromDb && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle className="h-4 w-4" />
            <span>✅ Config chargée depuis la base.</span>
          </div>
        )}

        {loadState === 'loaded' && !loadedFromDb && loadError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" />
            <span>{loadError}</span>
          </div>
        )}

        {loadState === 'empty' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" />
            <span>⚠️ Aucune configuration trouvée — veuillez la créer.</span>
          </div>
        )}

        {loadState === 'error' && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Erreur lors du chargement de la configuration&nbsp;: {loadError ?? 'Veuillez réessayer.'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom de la compétition
            </label>
            <input
              type="text"
              value={config.competition}
              onChange={(e) => handleConfigChange('competition', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Championnat de France"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Division
            </label>
            <select
              value={config.division}
              onChange={(e) => {
                const nextDivision = e.target.value;
                onConfigChange({ ...config, division: nextDivision });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {effectiveDivisionOptions.map((division) => (
                <option key={division} value={division}>
                  {division}
                </option>
              ))}
              {!effectiveDivisionOptions.length && (
                <option value={config.division || ''}>{config.division || 'Aucune division'}</option>
              )}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Round</label>
            <select
              value={config.round}
              onChange={(e) => {
                const nextRound = Number.parseInt(e.target.value, 10) || 1;
                const firstHeat = divisionHeatSequence
                  .filter((row) => row.round === nextRound)
                  .map((row) => row.heat_number)
                  .sort((a, b) => a - b)[0] ?? 1;
                onConfigChange({ ...config, round: nextRound, heatId: firstHeat });
              }}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {roundOptions.map((round) => (
                <option key={round} value={round}>
                  Round {round}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Heat #</label>
            <select
              value={config.heatId}
              onChange={(e) => handleConfigChange('heatId', Number.parseInt(e.target.value, 10) || 1)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {heatOptionsForRound.map((heatNumber) => (
                <option key={heatNumber} value={heatNumber}>
                  Heat {heatNumber}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vagues</label>
            <input
              type="number"
              min="1"
              max="20"
              value={config.waves}
              onChange={(e) => handleConfigChange('waves', parseInt(e.target.value) || 15)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Nombre de Juges (Mode Kiosk) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de Juges</label>
          <select
            value={config.judges.length}
            onChange={(e) => {
              const numJudges = parseInt(e.target.value);
              const judgeIds = Array.from({ length: numJudges }, (_, i) => `J${i + 1}`);
              const judgeNames = judgeIds.reduce((acc, id) => ({ ...acc, [id]: id }), {} as Record<string, string>);
              onConfigChange({
                ...config,
                judges: judgeIds,
                judgeNames: judgeNames
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
          disabled={configSaved || loadState === 'loading'}
          className={`w-full py-3 px-4 rounded-lg font-medium text-lg transition-colors ${configSaved
            ? 'bg-emerald-100 text-emerald-700 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          {configSaved ? '✅ Configuration sauvegardée' : 'Sauvegarder la configuration'}
        </button>

      </div>

      {/* Timer */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Clock className="w-6 h-6 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900">Timer du Heat</h2>
        </div>
        <HeatTimer
          key={`timer-${config.competition}-${config.division}-R${config.round}-H${config.heatId}`}
          timer={timer}
          onStart={handleTimerStart}
          onPause={handleTimerPause}
          onReset={handleTimerReset}
          onDurationChange={handleTimerDurationChange}
          configSaved={configSaved}
        />
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleTimerResume}
            disabled={!configSaved || timer.isRunning}
            className="py-2 px-4 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Reprendre (temps restant)
          </button>
          <button
            type="button"
            onClick={handleTimerRestartFull}
            disabled={!configSaved}
            className="py-2 px-4 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Recommencer (durée complète)
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Eye className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Affichage public</h2>
            <p className="text-sm text-gray-600">
              Ouvrez ou partagez le tableau de scores en temps réel sur un autre écran.
            </p>
          </div>
        </div>
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
          </div>
        ) : (
          <p className="text-sm text-red-600">
            Impossible de générer le lien pour l’instant. Sauvegardez la configuration puis réessayez.
          </p>
        )}
      </div>

      {/* Close Heat */}
      {configSaved && (
        <div className="bg-white rounded-lg shadow p-6">
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
              <p>Supabase mode: {supabaseMode || 'auto'}</p>
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
                      {config.judgeNames[judgeId] || judgeId}
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
        </div>
      )}

      {/* Paramètres avancés */}
      <div className="bg-white rounded-lg shadow p-6">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-medium text-gray-900">Paramètres avancés</h3>
          </div>
          <span className="text-gray-400">{showAdvanced ? '−' : '+'}</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
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
        )}
      </div>

      {/* Mode Kiosque - Liens Tablettes */}
      {configSaved && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Users className="w-6 h-6 text-purple-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Mode Kiosque - Tablettes</h2>
              <p className="text-sm text-gray-600">Liens directs pour tablettes J1 à J5</p>
            </div>
          </div>
          <div className="space-y-2">
            {["J1", "J2", "J3", "J4", "J5"].map(position => {
              const env = (import.meta as { env?: Record<string, string> }).env ?? {};
              const envBase =
                supabaseMode === 'local'
                  ? env.VITE_KIOSK_BASE_URL_LAN ||
                  env.VITE_KIOSK_BASE_URL_LOCAL ||
                  env.VITE_SITE_URL_LAN ||
                  env.VITE_SITE_URL_LOCAL ||
                  env.VITE_SITE_URL ||
                  env.VITE_KIOSK_BASE_URL
                  : supabaseMode === 'cloud'
                    ? env.VITE_KIOSK_BASE_URL_CLOUD ||
                    env.VITE_SITE_URL_CLOUD ||
                    env.VITE_KIOSK_BASE_URL ||
                    env.VITE_SITE_URL
                    : env.VITE_KIOSK_BASE_URL || env.VITE_SITE_URL;
              const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
              const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
              // Prefer envBase (LAN/Cloud config) over current origin if we are on localhost
              // or if we are explicitly in local mode.
              let kioskBase = (isPrivateHostname(currentHostname) && currentHostname !== 'localhost' && supabaseMode !== 'local') ? currentOrigin : '';
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
      )}

      {/* Override Chef Juge */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <button
          onClick={() => setShowOverridePanel(!showOverridePanel)}
          className="flex items-center justify-between w-full mb-4"
        >
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <ClipboardCheck className="w-5 h-5 mr-2 text-amber-500" /> Correction de notes
          </h2>
          {!configSaved && <span className="text-sm text-red-600">Configuration non sauvegardée</span>}
        </button>

        {showOverridePanel && (
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
        )}
      </div>

      {/* Historique des corrections */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Historique des overrides</h3>
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
    </div >
  );
};

export default AdminInterface;
