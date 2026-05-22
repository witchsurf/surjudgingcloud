import { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { User, Waves, Lock, Unlock, CreditCard as Edit3, Maximize, Minimize, Check, Delete, Trash2, AlertCircle } from 'lucide-react';
import { SURFER_COLORS } from '../utils/constants';
import type { AppConfig, EffectiveInterference, InterferenceCall, InterferenceType, PriorityState, Score, HeatTimer as HeatTimerType } from '../types';
import HeatTimer from './HeatTimer';
import { fetchHeatScores, updateJudgeName, fetchEventIdByName, fetchHeatMetadata, fetchInterferenceCalls, upsertInterferenceCall } from '../api/supabaseClient';
import { isSupabaseConfigured } from '../lib/supabase';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { computeEffectiveInterferences } from '../utils/interference';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { buildEqualPriorityState, getPriorityLabels, normalizePriorityState, promoteOpeningToOrdered, removePrioritySurfer, returnPrioritySurfer, setPriorityOrder } from '../utils/priority';
import { sanitizeScoreInput, validateScore } from '../utils/scoring';
import { canonicalizeScores } from '../api/modules/scoring.api';
import { subscribeToHeatScores } from '../lib/sharedHeatTableSubscriptions';

interface JudgeInterfaceProps {
  config?: AppConfig;
  judgeId?: string;
  judgeName?: string;
  onScoreSubmit?: (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>) => Promise<Score | void>;
  configSaved?: boolean;
  timer?: HeatTimerType;
  isChiefJudge?: boolean;
  scores?: Score[];
  heatStatus?: 'waiting' | 'running' | 'paused' | 'finished' | 'closed';
  onHeatClose?: () => void;
  isConnected?: boolean;
  onScoreSync?: () => Promise<{ success: number; failed: number }>;
  onPriorityConfigChange?: (config: AppConfig) => Promise<void>;
  canManagePriority?: boolean;
  priorityOnly?: boolean;
  interfaceTitle?: string;
}



interface ScoreInputState {
  surfer: string;
  wave: number;
  value: string;
}

function JudgeInterface({
  config = {
    competition: '',
    division: '',
    round: 1,
    heatId: 1,
    waves: 10,
    surfers: [],
    judges: [],
    judgeNames: {},
    surferNames: {},
    surferCountries: {},
    tournamentType: 'elimination',
    totalSurfers: 32,
    surfersPerHeat: 4,
    totalHeats: 8,
    totalRounds: 4
  },
  judgeId = 'CHIEF',
  judgeName,
  onScoreSubmit = async () => { },
  configSaved = false,
  timer = { startTime: null, duration: 20, isRunning: false },
  isChiefJudge = false,
  heatStatus = 'waiting',
  onHeatClose = () => { },
  isConnected = true,
  onScoreSync = async () => ({ success: 0, failed: 0 }),
  onPriorityConfigChange = async () => { },
  canManagePriority = false,
  priorityOnly = false,
  interfaceTitle
}: JudgeInterfaceProps) {


  const [submittedScores, setSubmittedScores] = useState<Score[]>([]);
  const [activeInput, setActiveInput] = useState<ScoreInputState | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [entryMode, setEntryMode] = useState<'score' | 'interference'>('score');
  const [interferenceType, setInterferenceType] = useState<InterferenceType>('INT1');
  const [headJudgeOverride, setHeadJudgeOverride] = useState(false);
  const [, setInterferenceCalls] = useState<InterferenceCall[]>([]);
  const [effectiveInterferences, setEffectiveInterferences] = useState<EffectiveInterference[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ message: string; type: 'success' | 'error' | null } | null>(null);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [isPriorityOrdering, setIsPriorityOrdering] = useState(false);
  const [priorityDraft, setPriorityDraft] = useState<string[]>([]);
  const [interactionWarning, setInteractionWarning] = useState<{ title: string; message: string } | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<{ surfer: string; wave: number; score: number; ts: number } | null>(null);
  const [scoreFeedback, setScoreFeedback] = useState<{ score: number; ts: number } | null>(null);
  const [judgeTimerTick, setJudgeTimerTick] = useState(Date.now());
  const [elapsedBadgeLatched, setElapsedBadgeLatched] = useState(false);
  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const lastTapRef = useRef<{ surfer: string; wave: number; time: number } | null>(null);
  const scoreRefreshInFlightRef = useRef(false);
  const lastSharedRefreshAtRef = useRef(0);
  const lastJudgeScoreSignatureRef = useRef('');

  // Unsynced safety check
  const pendingSyncCount = useMemo(() => submittedScores.filter(s => s.synced === false).length, [submittedScores]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingSyncCount > 0) {
        const msg = "Vous avez des notes non synchronisées en attente. Ne fermez pas la page !";
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingSyncCount]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const normalizeSurferKey = useCallback((value?: string | null): string => {
    const raw = (value || '').toUpperCase().trim();
    if (!raw) return '';
    return colorLabelMap[raw as HeatColor] ?? raw;
  }, []);

  const judgeStation = useMemo(() => {
    if (typeof window === 'undefined') return judgeId;
    return sessionStorage.getItem('kiosk_position') || sessionStorage.getItem('authenticated_judge_id') || judgeId;
  }, [judgeId]);

  const judgeIdentityId = useMemo(() => {
    if (typeof window === 'undefined') return judgeId;
    return sessionStorage.getItem('authenticated_judge_identity_id') || sessionStorage.getItem('authenticated_judge_id') || judgeId;
  }, [judgeId]);
  const isKioskJudge = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(sessionStorage.getItem('kiosk_position'));
  }, []);

  // Judge Name Modal State
  const [showNameModal, setShowNameModal] = useState(false);
  const [judgeNameInput, setJudgeNameInput] = useState('');
  const [isSubmittingName, setIsSubmittingName] = useState(false);
  const canEditPriority = canManagePriority || isChiefJudge;
  const resolvedInterfaceTitle = interfaceTitle || (isChiefJudge ? 'Interface Chef Juge' : 'Interface Juge');
  const compactGrid = config.waves >= 12;
  const ultraCompactGrid = config.waves >= 15;

  // Check if judge name is set
  useEffect(() => {
    if (priorityOnly) return;
    const configuredJudgeKey = (judgeStation || judgeId || '').trim();
    const configuredName = (config.judgeNames[configuredJudgeKey] || '').trim();
    const effectiveName = configuredName || judgeName?.trim() || '';

    if (!configSaved || !config.competition || !configuredJudgeKey || !config.judges.includes(configuredJudgeKey)) {
      setShowNameModal(false);
      return;
    }

    if (isKioskJudge || (effectiveName && effectiveName.toUpperCase() !== configuredJudgeKey.toUpperCase())) {
      setShowNameModal(false);
      return;
    }

    setShowNameModal(true);
  }, [priorityOnly, configSaved, config.competition, config.judgeNames, config.judges, judgeId, judgeName, judgeStation, isKioskJudge]);

  const handleNameSubmit = async () => {
    if (!judgeNameInput.trim()) return;

    setIsSubmittingName(true);
    try {
      console.log('📝 Submitting judge name:', judgeNameInput, 'for', judgeId);

      // Get event ID first - gracefully handle if not found
      const eventId = await resolveCurrentEventId();
      if (!eventId) {
        console.warn('⚠️ Event not found, skipping name update in events table');
        // Still allow judge to proceed - name update is optional
        setShowNameModal(false);
        setIsSubmittingName(false);
        return;
      }

      await updateJudgeName(eventId, judgeId, judgeNameInput.trim());
      console.log('✅ Judge name updated successfully');

      setShowNameModal(false);
    } catch (error) {
      console.warn('⚠️ Could not update judge name:', error);
      // Don't block the judge - just log and proceed
      setShowNameModal(false);
    } finally {
      setIsSubmittingName(false);
    }
  };

  const { normalized: currentHeatId } = useMemo(
    () =>
      getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
      ),
    [config.competition, config.division, config.round, config.heatId]
  );

  const resolveCurrentEventId = useCallback(async (): Promise<number | null> => {
    if (currentHeatId) {
      const heatMetadata = await fetchHeatMetadata(currentHeatId);
      if (heatMetadata?.event_id) {
        return heatMetadata.event_id;
      }
    }

    if (typeof window !== 'undefined') {
      const persistedEventIdRaw =
        localStorage.getItem('surfJudgingActiveEventId') ||
        localStorage.getItem('eventId');
      const persistedEventId = persistedEventIdRaw ? Number(persistedEventIdRaw) : NaN;
      if (Number.isFinite(persistedEventId) && persistedEventId > 0) {
        return persistedEventId;
      }
    }

    if (config.competition) {
      return await fetchEventIdByName(config.competition);
    }

    return null;
  }, [config.competition, currentHeatId]);

  const readScoresFromStorage = useCallback((): Score[] => {
    const savedScores = localStorage.getItem('surfJudgingScores');
    if (!savedScores) return [];

    try {
      const parsedScores: Score[] = JSON.parse(savedScores);
      return canonicalizeScores(parsedScores.filter((score) => {
        const sameJudge = score.judge_id === judgeId;
        const sameStation = (score.judge_station || score.judge_id) === judgeStation;
        const sameHeat = currentHeatId ? ensureHeatId(score.heat_id) === currentHeatId : false;
        return sameJudge && sameStation && sameHeat;
      }));
    } catch (error) {
      console.error('Erreur chargement scores juge:', error);
      return [];
    }
  }, [judgeId, currentHeatId]);

  const readAllScoresFromStorage = useCallback((): Score[] => {
    const savedScores = localStorage.getItem('surfJudgingScores');
    if (!savedScores) return [];
    try {
      const parsed = JSON.parse(savedScores) as Score[];
      return parsed.map((score) => ({
        ...score,
        heat_id: ensureHeatId(score.heat_id),
      }));
    } catch (error) {
      console.error('Erreur lecture cache scores:', error);
      return [];
    }
  }, []);

  const persistScoresToStorage = useCallback((scores: Score[]) => {
    const normalized = scores.map(score => ({
      ...score,
      heat_id: ensureHeatId(score.heat_id),
    }));
    localStorage.setItem('surfJudgingScores', JSON.stringify(normalized));
  }, []);
  const refetchJudgeScores = useCallback(async (reason: 'override' | 'shared_update' = 'shared_update') => {
    if (!currentHeatId || !judgeId) return;
    const now = Date.now();
    if (reason === 'shared_update' && (scoreRefreshInFlightRef.current || now - lastSharedRefreshAtRef.current < 1200)) {
      return;
    }
    try {
      scoreRefreshInFlightRef.current = true;
      if (reason === 'shared_update') {
        lastSharedRefreshAtRef.current = now;
      }
      const dbScores = await fetchHeatScores(currentHeatId);
      const myScores = dbScores.filter(s => 
        (s.judge_id === judgeId || (s.judge_station || s.judge_id) === judgeStation) &&
        ensureHeatId(s.heat_id) === ensureHeatId(currentHeatId)
      );
      const nextSignature = canonicalizeScores(myScores)
        .map((score) => `${score.id || 'no-id'}:${score.wave_number}:${score.score}:${score.timestamp}`)
        .join('|');
      if (reason === 'shared_update' && nextSignature === lastJudgeScoreSignatureRef.current) {
        return;
      }
      lastJudgeScoreSignatureRef.current = nextSignature;
      console.log(
        reason === 'override'
          ? '🔄 Re-syncing scores after admin override...'
          : '🔄 Judge scores updated from shared heat state'
      );
      
      if (myScores.length > 0) {
        setSubmittedScores(canonicalizeScores(myScores));
        persistScoresToStorage(myScores);
      } else {
        // If all my scores were moved away, clear local
        setSubmittedScores([]);
        persistScoresToStorage([]);
      }
    } catch (err) {
      console.warn('Failed to refetch scores after override:', err);
    } finally {
      scoreRefreshInFlightRef.current = false;
    }
  }, [currentHeatId, judgeId, judgeStation, persistScoresToStorage]);

  useEffect(() => {
    const handleOverride = (e: any) => {
      const { heatId: targetHeatId } = e.detail || {};
      if (ensureHeatId(targetHeatId) === ensureHeatId(currentHeatId)) {
        refetchJudgeScores('override');
      }
    };
    window.addEventListener('scoreOverrideApplied', handleOverride);
    return () => window.removeEventListener('scoreOverrideApplied', handleOverride);
  }, [currentHeatId, refetchJudgeScores]);

  useEffect(() => {
    if (!currentHeatId || !isSupabaseConfigured()) return () => { };

    const unsubscribe = subscribeToHeatScores(currentHeatId, () => {
      refetchJudgeScores('shared_update').catch((err) => {
        console.warn('Failed to refetch judge scores after shared heat update:', err);
      });
    }, { mode: 'realtime' });

    return () => {
      unsubscribe();
    };
  }, [currentHeatId, refetchJudgeScores]);


  const mergeRealtimeScore = useCallback((incoming: Score) => {
    if (!currentHeatId) return;
    const currentId = ensureHeatId(currentHeatId);
    const incomingId = ensureHeatId(incoming.heat_id);
    if (incomingId !== currentId) return;

    const normalised = { ...incoming, heat_id: incomingId };
    const existing = readAllScoresFromStorage();
    const merged = existing.some((score) => score.id === normalised.id)
      ? existing.map((score) => (score.id === normalised.id ? normalised : score))
      : [...existing, normalised];
    persistScoresToStorage(merged);
    setSubmittedScores(canonicalizeScores(
      merged.filter(score => score.heat_id === currentId && score.judge_id === judgeId)
        .filter(score => (score.judge_station || score.judge_id) === judgeStation)
    ));
  }, [currentHeatId, judgeId, judgeStation, persistScoresToStorage, readAllScoresFromStorage]);

  const refreshInterferenceCalls = useCallback(async () => {
    if (!currentHeatId || !isSupabaseConfigured()) return;
    try {
      const calls = await fetchInterferenceCalls(currentHeatId);
      setInterferenceCalls(calls);
      setEffectiveInterferences(computeEffectiveInterferences(calls, Math.max(config.judges.length, 1)));
    } catch (error) {
      console.warn('Impossible de charger les interférences', error);
      setInterferenceCalls([]);
      setEffectiveInterferences([]);
    }
  }, [currentHeatId, config.judges.length]);

  // Charger les scores soumis depuis localStorage
  useEffect(() => {
    setSubmittedScores(readScoresFromStorage());
  }, [readScoresFromStorage]);

  useEffect(() => {
    refreshInterferenceCalls().catch(() => { });
  }, [refreshInterferenceCalls]);

  // Écouter les changements de scores
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'surfJudgingScores' && e.newValue) {
        setSubmittedScores(readScoresFromStorage());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [readScoresFromStorage]);

  useEffect(() => {
    const hydrateHeatScores = async () => {
      if (!currentHeatId) return;



      if (!isSupabaseConfigured()) {
        console.log('Mode local uniquement - conservation des scores locaux');
        return;
      }

      try {
        const remoteScores = await fetchHeatScores(currentHeatId);

        // UNIVERSAL MERGE STRATEGY (Map-based)
        // Source of Truth: ID-based Map. 
        // 1. Start with ALL local scores
        const scoreMap = new Map<string, Score>();
        const allLocalScores = readAllScoresFromStorage();

        allLocalScores.forEach(s => {
          if (s.id) scoreMap.set(s.id, s);
        });

        console.log('🔍 Hydration Start:', {
          localCount: scoreMap.size,
          remoteCount: remoteScores.length
        });

        // 2. Merge Remote Scores
        let updatedCount = 0;
        let conflictCount = 0;
        let newRemoteCount = 0;

        remoteScores.forEach(remote => {
          if (!remote.id) return;

          const local = scoreMap.get(remote.id);
          if (!local) {
            // New score from server
            scoreMap.set(remote.id, remote);
            newRemoteCount++;
          } else {
            // Conflict Resolution via Timestamp
            const remoteTime = new Date(remote.timestamp).getTime();
            const localTime = new Date(local.timestamp).getTime();

            // If remote is newer or equal, we accept it. 
            // If local is strictly newer, we KEEP local (pending sync).
            if (remoteTime >= localTime) {
              scoreMap.set(remote.id, remote);
              updatedCount++;
            } else {
              conflictCount++;
              console.log('⚠️ Keeping newer local score:', {
                id: local.id,
                localTime: local.timestamp,
                remoteTime: remote.timestamp
              });
            }
          }
        });

        console.log('✅ Hydration Merge Complete:', {
          total: scoreMap.size,
          newFromRemote: newRemoteCount,
          updatedFromRemote: updatedCount,
          keptLocalOverrides: conflictCount
        });

        // 3. Persist Merged State
        const finalScores = Array.from(scoreMap.values());
        persistScoresToStorage(finalScores);

        // 4. Update UI
        // Filter for current heat & judge (Case Insensitive)
        const displayScores = finalScores.filter((score) =>
          ensureHeatId(score.heat_id) === currentHeatId &&
          (score.judge_station || score.judge_id)?.toLowerCase() === judgeStation?.toLowerCase()
        );

        setSubmittedScores(canonicalizeScores(displayScores));



      } catch (error) {
        console.warn('Impossible de synchroniser les scores du heat - conservation des données locales', error);
        // Ne PAS purger les données locales en cas d'erreur de connexion
      }
    };

    hydrateHeatScores().catch((error) => {
      console.warn('Erreur hydratation scores', error);
    });
  }, [currentHeatId, judgeId, judgeStation, readAllScoresFromStorage, persistScoresToStorage, readScoresFromStorage]);

  useEffect(() => {
    const handleRealtimeScore = (event: Event) => {
      const custom = event as CustomEvent<Score>;
      if (!custom.detail) return;
      mergeRealtimeScore(custom.detail);
    };

    window.addEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
    return () => window.removeEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
  }, [mergeRealtimeScore]);

  useLayoutEffect(() => {
    if (!activeInputRef.current) return;

    const input = activeInputRef.current;
    input.focus();
    input.select();
  }, [activeInput]);

  // Vérifier si la saisie est autorisée
  // BLOQUE : avant démarrage (waiting) et après clôture chief judge (closed)
  // AUTORISE : pendant (running), en pause (paused), et après expiration simple du timer (finished)
  const isTimerActive = () => {
    if (!configSaved) return false;
    if (heatStatus === 'closed') return false;
    const heatHasStarted = Boolean(timer?.startTime);
    if (heatStatus === 'waiting' && !heatHasStarted) return false;
    return true;
  };

  const getScoreForWave = (surfer: string, wave: number) => {
    const surferKey = normalizeSurferKey(surfer);
    return submittedScores.find(
      s =>
        normalizeSurferKey(s.surfer) === surferKey &&
        s.wave_number === wave &&
        (s.judge_station || s.judge_id) === judgeStation
    );
  };

  const getNextAvailableWave = (surfer: string): number => {
    // Trouver la première vague non notée pour ce surfeur
    for (let wave = 1; wave <= config.waves; wave++) {
      if (!getScoreForWave(surfer, wave)) {
        return wave;
      }
    }
    return config.waves + 1; // Toutes les vagues sont notées
  };

  const canScoreWave = (surfer: string, wave: number): boolean => {
    // On peut noter une vague seulement si c'est la prochaine vague disponible
    const nextWave = getNextAvailableWave(surfer);
    return wave === nextWave;
  };

  const handleCellClick = (surfer: string, wave: number) => {
    if (!timerActive) {
      setInteractionWarning({
        title: heatStatus === 'waiting' && !timer?.startTime ? 'Timer non démarré' : 'Notation bloquée',
        message: heatStatus === 'waiting' && !timer?.startTime
          ? 'Attendez que le chef juge démarre le timer avant de noter.'
          : 'Le heat est clôturé. La notation est désactivée.',
      });
      return;
    }
    if (entryMode === 'interference') {
      handleInterferenceCall(surfer, wave).catch((error) => {
        console.error('❌ Erreur interférence:', error);
        alert('Impossible d’enregistrer l’interférence.');
      });
      return;
    }

    const existingScore = getScoreForWave(surfer, wave);

    if (activeInput && activeInput.surfer === surfer && activeInput.wave === wave) {
      setActiveInput(null);
      setInputValue('');
      try { navigator?.vibrate?.(10); } catch {}
      return;
    }

    if (existingScore) {
      // Cellule déjà notée: double-tap requis pour déverrouiller
      const now = Date.now();
      const prevTap = lastTapRef.current;

      if (prevTap && prevTap.surfer === surfer && prevTap.wave === wave && (now - prevTap.time) < 350) {
        lastTapRef.current = null; // reset
        setActiveInput({ surfer, wave, value: existingScore.score.toString() });
        setInputValue(existingScore.score.toString());
        try { navigator?.vibrate?.(30); } catch {}
      } else {
        lastTapRef.current = { surfer, wave, time: now };
        setInteractionWarning({
          title: 'Cellule Verrouillée 🔒',
          message: 'Double-cliquez pour modifier ce score.',
        });
      }
      return;
    }

    // Cellule vide: doit être la prochaine vague disponible
    if (!canScoreWave(surfer, wave)) return;

    setActiveInput({ surfer, wave, value: '' });
    setInputValue('');
    try { navigator?.vibrate?.(10); } catch {}
  };

  const handleInterferenceCall = async (surfer: string, wave: number) => {
    if (!currentHeatId) return;
    const eventId = await resolveCurrentEventId();
    if (!eventId) {
      throw new Error('Événement introuvable pour enregistrer l’interférence.');
    }
    const judgeName = config.judgeNames[judgeId] || judgeId;
    const normalizedSurfer = normalizeSurferKey(surfer);
    await upsertInterferenceCall({
      event_id: eventId,
      heat_id: currentHeatId,
      competition: config.competition,
      division: config.division,
      round: config.round,
      judge_id: judgeId,
      judge_name: judgeName,
      judge_station: judgeStation,
      judge_identity_id: judgeIdentityId,
      surfer: normalizedSurfer,
      wave_number: wave,
      call_type: interferenceType,
      is_head_judge_override: isChiefJudge && headJudgeOverride,
    });
    await refreshInterferenceCalls();
  };

  const handleScoreSubmit = async () => {
    if (isSubmittingScore) return;
    if (!activeInput || !inputValue.trim()) return;
    if (!timerActive) {
      setActiveInput(null);
      setInputValue('');
      return;
    }

    const validation = validateScore(inputValue);
    if (!validation.isValid || validation.value === undefined) {
      alert(validation.error || 'Le score est invalide');
      return;
    }
    const scoreValue = validation.value;

    try {
      setIsSubmittingScore(true);
      const judgeName = config.judgeNames[judgeId] || judgeId;

      const savedScore = await onScoreSubmit({
        competition: config.competition,
        division: config.division,
        round: config.round,
        judge_id: judgeId,
        judge_name: judgeName,
        judge_station: judgeStation,
        judge_identity_id: judgeIdentityId,
        surfer: activeInput.surfer,
        wave_number: activeInput.wave,
        score: scoreValue
      });

      if (savedScore) {
        const sanitizedScore = {
          ...savedScore,
          heat_id: savedScore.heat_id || currentHeatId,
          judge_id: savedScore.judge_id || judgeId,
          judge_station: savedScore.judge_station || judgeStation,
          judge_identity_id: savedScore.judge_identity_id || judgeIdentityId
        };

        if (!currentHeatId || sanitizedScore.heat_id === currentHeatId) {
          // CRITICAL FIX: Persist to localStorage FIRST
          const allScores = readAllScoresFromStorage();
          const updatedScores = allScores.some((score) => score.id === sanitizedScore.id)
            ? allScores.map((score) => (score.id === sanitizedScore.id ? sanitizedScore : score))
            : [...allScores, sanitizedScore];
          persistScoresToStorage(updatedScores);

          // THEN update state
          setSubmittedScores(prev => {
            const nextScores = prev.some((score) => score.id === sanitizedScore.id)
              ? prev.map((score) => (score.id === sanitizedScore.id ? sanitizedScore : score))
              : [...prev, sanitizedScore];
            return canonicalizeScores(nextScores);
          });
        }
      }

      // Haptic + visual feedback
      setLastSubmitted({ surfer: activeInput.surfer, wave: activeInput.wave, score: scoreValue, ts: Date.now() });
      setScoreFeedback({ score: scoreValue, ts: Date.now() });
      try { navigator?.vibrate?.(50); } catch { /* vibrate not supported */ }
      setTimeout(() => setLastSubmitted(null), 600);
      setTimeout(() => setScoreFeedback(null), 2000);

      // Keep control manual after each score to avoid accidental wrong-wave entries.
      setActiveInput(null);
      setInputValue('');

    } catch (error) {
      console.error('❌ Erreur soumission score:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Saisie bloquée')) {
        if (message.includes('non démarré')) {
          alert('Impossible de saisir un score : le timer n\'a pas encore été démarré.');
        } else {
          alert('Impossible de saisir un score : le heat a été clôturé par le chef juge.');
        }
      } else {
        alert('Erreur lors de la soumission du score');
      }
    } finally {
      setIsSubmittingScore(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleScoreSubmit();
    } else if (e.key === 'Escape') {
      setActiveInput(null);
      setInputValue('');
    }
  };

  const getSurferColor = (surfer: string) => {
    return SURFER_COLORS[normalizeSurferKey(surfer)] || '#6B7280';
  };

  const getPriorityBadgeStyle = (surfer: string): CSSProperties => {
    const key = normalizeSurferKey(surfer);
    const needsDarkText = key === 'BLANC' || key === 'WHITE' || key === 'JAUNE' || key === 'YELLOW';

    return {
      backgroundColor: getSurferColor(surfer),
      borderColor: needsDarkText ? 'rgba(15, 23, 42, 0.42)' : 'rgba(255, 255, 255, 0.45)',
      color: needsDarkText ? '#0f172a' : '#ffffff',
      textShadow: needsDarkText ? '0 1px 0 rgba(255, 255, 255, 0.45)' : '0 1px 2px rgba(0, 0, 0, 0.65)',
    };
  };

  const normalizedSurfers = useMemo(
    () => config.surfers.map(normalizeSurferKey).filter(Boolean),
    [config.surfers, normalizeSurferKey]
  );

  const priorityState = useMemo(
    () => normalizePriorityState(config.priorityState, normalizedSurfers),
    [config.priorityState, normalizedSurfers]
  );

  const priorityLabels = useMemo(
    () => getPriorityLabels(priorityState, normalizedSurfers),
    [priorityState, normalizedSurfers]
  );

  const orderedPrioritySurfers = useMemo(
    () => priorityState.order.map(normalizeSurferKey),
    [priorityState.order, normalizeSurferKey]
  );

  const inFlightSurfers = useMemo(
    () => priorityState.inFlight.map(normalizeSurferKey),
    [priorityState.inFlight, normalizeSurferKey]
  );

  const orderedDraft = useMemo(
    () => priorityDraft.map(normalizeSurferKey).filter(Boolean),
    [priorityDraft, normalizeSurferKey]
  );

  const availableDraftSurfers = useMemo(
    () => normalizedSurfers.filter((surfer) => !orderedDraft.includes(surfer)),
    [normalizedSurfers, orderedDraft]
  );

  const savePriorityState = useCallback(async (nextPriorityState: PriorityState) => {
    const nextConfig: AppConfig = {
      ...config,
      priorityState: nextPriorityState,
    };

    try {
      await onPriorityConfigChange(nextConfig);
    } catch (error) {
      console.error('Erreur mise à jour priorité:', error);
      alert('Impossible de mettre à jour la priorité.');
    }
  }, [config, onPriorityConfigChange]);

  const handlePrioritySurferTap = useCallback(async (surfer: string) => {
    const normalizedSurfer = normalizeSurferKey(surfer);
    if (!normalizedSurfer) return;

    if (priorityState.mode === 'equal') {
      const nextState = promoteOpeningToOrdered(
        removePrioritySurfer(priorityState, normalizedSurfer),
        normalizedSurfers
      );
      await savePriorityState(nextState);
      return;
    }

    if (priorityState.mode === 'opening') {
      if (inFlightSurfers.includes(normalizedSurfer)) {
        const nextState = promoteOpeningToOrdered(
          returnPrioritySurfer(priorityState, normalizedSurfer),
          normalizedSurfers
        );
        await savePriorityState(nextState);
        return;
      }

      const nextState = promoteOpeningToOrdered(
        removePrioritySurfer(priorityState, normalizedSurfer),
        normalizedSurfers
      );
      await savePriorityState(nextState);
      return;
    }

    if (orderedPrioritySurfers.includes(normalizedSurfer)) {
      await savePriorityState(removePrioritySurfer(priorityState, normalizedSurfer));
      return;
    }

    if (inFlightSurfers.includes(normalizedSurfer)) {
      await savePriorityState(returnPrioritySurfer(priorityState, normalizedSurfer));
    }
  }, [inFlightSurfers, normalizeSurferKey, normalizedSurfers, orderedPrioritySurfers, priorityState, savePriorityState]);

  const handlePriorityResetEqual = useCallback(async () => {
    setIsPriorityOrdering(false);
    setPriorityDraft([]);
    await savePriorityState(buildEqualPriorityState());
  }, [savePriorityState]);

  const handlePriorityOrderStart = useCallback(() => {
    setIsPriorityOrdering(true);
    setPriorityDraft([]);
  }, []);

  const handlePriorityDraftAdd = useCallback((surfer: string) => {
    const normalizedSurfer = normalizeSurferKey(surfer);
    if (!normalizedSurfer || orderedDraft.includes(normalizedSurfer)) return;
    setPriorityDraft((prev) => [...prev, normalizedSurfer]);
  }, [normalizeSurferKey, orderedDraft]);

  const handlePriorityDraftRemove = useCallback((surfer: string) => {
    const normalizedSurfer = normalizeSurferKey(surfer);
    setPriorityDraft((prev) => prev.filter((item) => item !== normalizedSurfer));
  }, [normalizeSurferKey]);

  const handlePriorityOrderSave = useCallback(async () => {
    if (orderedDraft.length !== normalizedSurfers.length) return;
    await savePriorityState(setPriorityOrder(orderedDraft));
    setIsPriorityOrdering(false);
    setPriorityDraft([]);
  }, [normalizedSurfers.length, orderedDraft, savePriorityState]);

  useEffect(() => {
    if (!interactionWarning) return;
    const timerId = window.setTimeout(() => setInteractionWarning(null), 2600);
    return () => window.clearTimeout(timerId);
  }, [interactionWarning]);

  useEffect(() => {
    if (priorityOnly || heatStatus === 'closed' || !timer?.startTime) return;

    setJudgeTimerTick(Date.now());
    const intervalId = window.setInterval(() => setJudgeTimerTick(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [heatStatus, priorityOnly, timer?.startTime]);

  const timerActive = isTimerActive();
  const timerHasElapsed = useMemo(() => {
    if (!timer?.startTime) return false;

    const startMs = new Date(timer.startTime).getTime();
    if (!Number.isFinite(startMs)) return false;
    const durationMs = Math.max(0, Number(timer.duration || 0)) * 60 * 1000;
    return judgeTimerTick - startMs >= durationMs;
  }, [judgeTimerTick, timer?.duration, timer?.startTime]);

  useEffect(() => {
    setElapsedBadgeLatched(false);
  }, [currentHeatId]);

  useEffect(() => {
    if (priorityOnly || heatStatus === 'closed') {
      setElapsedBadgeLatched(false);
      return;
    }
    if (heatStatus === 'finished' || timerHasElapsed) {
      setElapsedBadgeLatched(true);
    }
  }, [heatStatus, priorityOnly, timerHasElapsed]);

  const judgeTimerElapsed = !priorityOnly && heatStatus !== 'closed' && elapsedBadgeLatched;

  // Custom surfer color borders neon glow classes
  const getSurferColorClass = useCallback((surferName: string): string => {
    const normalized = normalizeSurferKey(surferName).toUpperCase();
    if (normalized.includes('ROUGE') || normalized === 'RED') return 'neon-glow-ROUGE';
    if (normalized.includes('BLANC') || normalized === 'WHITE') return 'neon-glow-BLANC';
    if (normalized.includes('JAUNE') || normalized === 'YELLOW') return 'neon-glow-JAUNE';
    if (normalized.includes('BLEU') || normalized === 'BLUE') return 'neon-glow-BLEU';
    if (normalized.includes('VERT') || normalized === 'GREEN') return 'neon-glow-VERT';
    if (normalized.includes('NOIR') || normalized === 'BLACK') return 'neon-glow-NOIR';
    return 'border-slate-800';
  }, [normalizeSurferKey]);

  // Keyboard suppression - virtual keypress programmatical mapping handler
  const handleVirtualKeyPress = useCallback((key: string) => {
    if (!activeInput) return;
    
    if (key === 'CLR') {
      setInputValue('');
    } else if (key === 'DEL') {
      setInputValue(prev => prev.slice(0, -1));
    } else if (key === 'ENTR') {
      handleScoreSubmit();
    } else {
      setInputValue(prev => {
        const nextValue = prev + key;
        return sanitizeScoreInput(nextValue);
      });
    }
  }, [activeInput, handleScoreSubmit]);

  // Listen to physical keyboard events globally when a cell is active
  useEffect(() => {
    if (!activeInput) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        handleScoreSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setActiveInput(null);
        setInputValue('');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputValue(prev => prev.slice(0, -1));
      } else if (e.key === '.' || e.key === ',') {
        e.preventDefault();
        setInputValue(prev => sanitizeScoreInput(prev + '.'));
      } else if (/[0-9]/.test(e.key)) {
        e.preventDefault();
        setInputValue(prev => sanitizeScoreInput(prev + e.key));
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeInput, handleScoreSubmit]);

  const effectiveByTarget = useMemo(() => {
    const map = new Map<string, EffectiveInterference>();
    effectiveInterferences.forEach((item) => {
      map.set(`${normalizeSurferKey(item.surfer)}::${item.waveNumber}`, item);
    });
    return map;
  }, [effectiveInterferences, normalizeSurferKey]);

  if (!configSaved) {
    return (
      <div className="min-h-screen bg-hud-black text-slate-100 flex items-center justify-center p-6">
        <div className="neon-card border border-white/10 rounded-xl p-8 max-w-md text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/30 mb-4 animate-pulse">
            <Waves className="w-8 h-8 text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold text-slate-100 mb-2">En attente de configuration</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            L'interface de notation sera disponible une fois la compétition configurée par l'administrateur.
          </p>
        </div>
      </div>
    );
  }

  const priorityShellClass = priorityOnly
    ? 'judge-shell judge-priority-shell max-w-5xl mx-auto px-3 sm:px-5 md:px-6 py-3 sm:py-4 flex flex-col bg-hud-black text-slate-100'
    : 'judge-shell max-w-full mx-auto flex flex-col bg-hud-black text-slate-100';

  const priorityCardPadding = priorityOnly ? 'p-4 sm:p-5' : 'p-2 sm:p-3';

  const renderKeypad = () => {
    const keys = [
      ['7', '8', '9'],
      ['4', '5', '6'],
      ['1', '2', '3'],
      ['CLR', '0', '.'],
    ];

    return (
      <div className="bg-slate-950 rounded-lg border border-slate-800 p-1.5">
        <div className="judge-keypad">
          {keys.flat().map((key) => {
            let btnClass = "judge-key text-lg font-bold rounded-md flex items-center justify-center active:scale-95 touch-manipulation ";
            if (key === 'CLR') {
              btnClass += "bg-red-900/30 text-red-400 border border-red-900/40";
            } else if (key === '.') {
              btnClass += "bg-slate-800 text-slate-300 border border-slate-700";
            } else {
              btnClass += "bg-slate-800 text-slate-100 border border-slate-700";
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  try { navigator?.vibrate?.(15); } catch {}
                  handleVirtualKeyPress(key);
                }}
                className={btnClass}
              >
                {key}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-1.5 pb-1.5">
          <button
            type="button"
            onClick={() => {
              try { navigator?.vibrate?.(15); } catch {}
              handleVirtualKeyPress('DEL');
            }}
            className="judge-key bg-amber-900/20 text-amber-400 border border-amber-900/30 font-bold rounded-md text-sm flex items-center justify-center gap-1 active:scale-95 touch-manipulation"
          >
            <Delete className="w-4 h-4" /> DEL
          </button>
          <button
            type="button"
            onClick={() => {
              try { navigator?.vibrate?.(40); } catch {}
              handleVirtualKeyPress('ENTR');
            }}
            disabled={isSubmittingScore || !inputValue.trim()}
            className="judge-key bg-emerald-600 text-white font-bold rounded-md text-sm flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
          >
            <Check className="w-4 h-4" /> OK
          </button>
        </div>
      </div>
    );
  };

  const renderScoreInput = () => {
    if (!activeInput) return null;
    return (
      <div className="judge-score-input bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 flex items-center gap-2.5 flex-shrink-0">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getSurferColor(activeInput.surfer) }} />
        <span className="text-sm font-bold text-slate-200 truncate">{activeInput.surfer}</span>
        <span className="text-xs text-slate-400">V{activeInput.wave}</span>
        <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 ml-auto">{inputValue || '—'}</span>
        <button
          type="button"
          onClick={() => { setActiveInput(null); setInputValue(''); }}
          className="text-xs text-red-400 hover:text-red-300 font-bold ml-2"
        >
          ✕
        </button>
      </div>
    );
  };

  return (
    <div className={priorityShellClass}>
      {/* HEADER + TIMER */}
      <div className={isFullscreen ? 'sticky top-[max(0.5rem,env(safe-area-inset-top))] z-40' : ''}>
        <div className={`neon-card border border-white/5 rounded-xl shadow-2xl ${priorityCardPadding}`}>
          <div className={priorityOnly ? `flex items-center justify-between gap-3 sm:gap-5` : 'judge-header-grid'}>
            <div className={`flex items-center justify-between flex-1 min-w-0 ${priorityOnly ? 'gap-3 sm:gap-6' : 'gap-2'}`}>
              <div className="min-w-0">
                <h1 className={`${priorityOnly ? 'text-xl sm:text-2xl md:text-3xl' : 'text-lg sm:text-xl'} font-extrabold flex items-center gap-2 truncate text-slate-100`}>
                  {resolvedInterfaceTitle}
                  {!isConnected && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-950/60 border border-red-800/40 text-red-400 animate-pulse">
                      Hors Ligne
                    </span>
                  )}
                </h1>
                <div className={`judge-header-meta text-slate-400 ${priorityOnly ? 'text-xs sm:text-sm mt-1.5' : 'text-[10px]'}`}>
                  <span className={`font-bold text-slate-200 truncate ${priorityOnly ? 'max-w-[160px] sm:max-w-[220px]' : 'max-w-[100px]'}`}>{config.judgeNames[judgeId] || judgeName || judgeId}</span>
                  <span className="text-slate-600">•</span>
                  <span className={`${priorityOnly ? 'max-w-[180px] sm:max-w-[260px]' : 'max-w-[100px]'} truncate`}>{config.competition}</span>
                  <span className="text-slate-600">•</span>
                  <span className={`font-bold uppercase truncate ${priorityOnly ? 'max-w-[160px] sm:max-w-[220px]' : 'max-w-[100px]'} text-slate-300`}>{config.division || 'Sans categorie'}</span>
                  <span className="text-slate-600">•</span>
                  <span className="font-extrabold text-indigo-400">R{config.round} H{config.heatId}</span>
                </div>
              </div>

              <div className={priorityOnly ? 'flex-shrink-0' : 'judge-timer-wrap flex-shrink-0'}>
                <HeatTimer
                  timer={timer}
                  onStart={() => { }}
                  onPause={() => { }}
                  onReset={() => { }}
                  onDurationChange={() => { }}
                  showControls={isChiefJudge}
                  size={priorityOnly ? 'medium' : 'small'}
                  compact={!priorityOnly}
                  landscape={true}
                  embedded={true}
                  configSaved={configSaved}
                />
              </div>
            </div>
            
            <div className={priorityOnly ? 'flex items-center gap-2' : 'judge-actions'}>
              {!priorityOnly && (
                <div className="relative">
                  <button
                    onClick={async () => {
                      setIsSyncing(true);
                      setSyncFeedback(null);
                      try {
                        const result = await onScoreSync();
                        setSyncFeedback({
                          message: `${result.success} synchronisés`,
                          type: 'success'
                        });
                        setTimeout(() => setSyncFeedback(null), 3000);
                      } catch {
                        setSyncFeedback({
                          message: 'Erreur',
                          type: 'error'
                        });
                      } finally {
                        setIsSyncing(false);
                      }
                    }}
                    disabled={isSyncing || !isConnected}
                    className={`min-h-[34px] flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-lg transition-all text-xs font-bold border shadow-sm ${isSyncing
                      ? 'bg-slate-800/50 text-slate-500 border-slate-700/30'
                      : 'bg-indigo-950/40 text-indigo-300 border-indigo-900/30 hover:bg-indigo-900/30 active:scale-95'
                      }`}
                  >
                    <div className={`w-4 h-4 flex items-center justify-center ${isSyncing ? 'animate-spin' : ''}`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                    <span>{isSyncing ? '...' : 'Sync'}</span>
                  </button>
                  {pendingSyncCount > 0 && (
                    <div className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[9px] font-bold min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full border border-slate-950 animate-pulse">
                      {pendingSyncCount}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={toggleFullscreen}
                className={`min-h-[34px] flex items-center justify-center space-x-1 bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors font-bold border border-slate-800 ${priorityOnly ? 'px-3.5 py-2 text-sm' : 'px-2.5 py-1.5 text-xs'}`}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                <span className="hidden sm:inline">{isFullscreen ? 'Réduire' : 'Plein Écran'}</span>
              </button>
            </div>
          </div>

          {!priorityOnly && syncFeedback && (
            <div className={`px-3 py-1.5 rounded-lg border bg-slate-950 text-xs font-bold inline-flex items-center absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap z-50 shadow-xl ${syncFeedback.type === 'success' ? 'text-emerald-400 border-emerald-900/50' : 'text-red-400 border-red-900/50'
              }`}>
              {syncFeedback.type === 'success' ? '✅' : '❌'} {syncFeedback.message}
            </div>
          )}
        </div>
      </div>

      {!priorityOnly && judgeTimerElapsed && (
        <div className="judge-elapsed-badge flex-shrink-0">
          <AlertCircle className="w-4 h-4" />
          <span>TEMPS ÉCOULÉ</span>
          <small>En attente de clôture chef juge</small>
        </div>
      )}

      {heatStatus === 'closed' && (
        <div className="mt-3 rounded-xl border border-red-900 bg-red-950/30 px-6 py-4 text-center shadow-lg flex-shrink-0">
          <div className="font-sans font-black text-2xl tracking-[0.25em] text-red-400 leading-none uppercase">
            HEAT CLOTURE / OVER
          </div>
        </div>
      )}

      {(priorityOnly || canEditPriority) && (
        <div className="neon-card rounded-xl border border-white/5 overflow-hidden flex-shrink-0 mt-3">
          <div className={`bg-slate-950 border-b border-slate-900 flex items-center justify-between gap-3 ${priorityOnly ? 'px-4 py-3 sm:px-5' : 'px-3 py-2.5'}`}>
            <div>
              <h2 className={`${priorityOnly ? 'text-2xl sm:text-3xl' : 'text-base'} font-black text-slate-100 leading-tight`}>Priorité</h2>
              <p className={`${priorityOnly ? 'text-xs sm:text-sm mt-1' : 'text-[10px]'} text-slate-400 leading-tight`}>
                {priorityState.mode === 'equal'
                  ? 'Début de série : tous les surfeurs sont égaux.'
                  : priorityState.mode === 'opening'
                    ? 'Phase initiale : chaque premier départ construit la priorité par la fin.'
                    : 'Touchez un surfeur quand il part ou revient.'}
              </p>
            </div>
            {canEditPriority && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePriorityResetEqual().catch(() => { })}
                  className={`rounded-lg bg-indigo-600 font-bold text-white hover:bg-indigo-500 transition-colors ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-1.5 text-xs'}`}
                >
                  Egalité
                </button>
                {isPriorityOrdering ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPriorityOrdering(false);
                        setPriorityDraft([]);
                      }}
                      className={`rounded-lg border border-slate-800 bg-slate-900 font-bold text-slate-300 hover:bg-slate-800 transition-colors ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-1.5 text-xs'}`}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePriorityOrderSave().catch(() => { })}
                      disabled={orderedDraft.length !== normalizedSurfers.length}
                      className={`rounded-lg border border-emerald-900 bg-emerald-950/30 font-bold text-emerald-400 hover:bg-emerald-900/30 transition-colors disabled:cursor-not-allowed disabled:opacity-20 ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-1.5 text-xs'}`}
                    >
                      Valider l&apos;ordre
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handlePriorityOrderStart}
                    className={`rounded-lg border border-slate-800 bg-slate-900 font-bold text-slate-300 hover:bg-slate-800 transition-colors ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-1.5 text-xs'}`}
                  >
                    Définir l&apos;ordre
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={`${priorityOnly ? 'p-4 sm:p-5 space-y-5' : 'p-3 space-y-3'}`}>
            {isPriorityOrdering ? (
              <>
                <div>
                  <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-xs'} font-bold text-slate-300 mb-2.5`}>Touchez les surfeurs dans l&apos;ordre P, 2, 3, 4.</p>
                  <div className="flex flex-wrap gap-2.5">
                    {availableDraftSurfers.map((surfer) => (
                      <button
                        key={surfer}
                        type="button"
                        onClick={() => handlePriorityDraftAdd(surfer)}
                        className={`flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-850 px-3.5 py-2.5 text-sm transition-colors`}
                      >
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-900" style={{ backgroundColor: getSurferColor(surfer) }} />
                        <span className="font-extrabold text-slate-100">{surfer}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-xs'} font-bold text-slate-300 mb-2.5`}>Ordre en cours</p>
                  <div className="flex flex-wrap gap-2.5">
                    {orderedDraft.length > 0 ? orderedDraft.map((surfer, index) => (
                      <button
                        key={surfer}
                        type="button"
                        onClick={() => handlePriorityDraftRemove(surfer)}
                        className={`flex items-center gap-2 rounded-xl border border-indigo-900/50 bg-indigo-950/20 shadow-sm px-3.5 py-2 transition-colors`}
                      >
                        <span className="inline-flex justify-center items-center rounded-md bg-indigo-600 font-black text-white px-2 py-0.5 text-xs">
                          {index === 0 ? 'P' : index + 1}
                        </span>
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-950" style={{ backgroundColor: getSurferColor(surfer) }} />
                        <span className="font-extrabold text-slate-100">{surfer}</span>
                      </button>
                    )) : (
                      <div className="rounded-xl border border-dashed border-slate-800 px-4 py-3 text-xs text-slate-500">
                        Aucun ordre défini pour l&apos;instant.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-xs'} font-bold text-slate-400 mb-2.5 uppercase tracking-widest`}>
                    {priorityState.mode === 'equal' ? 'Tous égaux' : priorityState.mode === 'opening' ? 'Phase initiale' : 'Line-up'}
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    {(priorityState.mode === 'equal' ? normalizedSurfers : priorityState.mode === 'opening' ? normalizedSurfers : orderedPrioritySurfers).map((surfer) => (
                      <button
                        key={surfer}
                        type="button"
                        onClick={() => handlePrioritySurferTap(surfer).catch(() => { })}
                        disabled={!canEditPriority}
                        className={`flex items-center gap-2.5 rounded-xl border border-slate-800/80 bg-slate-900/60 shadow-sm disabled:cursor-default px-3 py-2.5`}
                      >
                        <span className={`inline-flex items-center justify-center rounded-md font-black min-w-[24px] px-1.5 h-6 text-xs ${priorityState.mode === 'equal' ? 'bg-slate-800 text-slate-400 border border-slate-700/30' : 'bg-indigo-600 text-white'}`}>
                          {priorityLabels[surfer] || '='}
                        </span>
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-950" style={{ backgroundColor: getSurferColor(surfer) }} />
                        <span className="font-extrabold text-slate-100">{surfer}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {priorityState.mode === 'ordered' && (
                  <div>
                    <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-xs'} font-bold text-slate-400 mb-2.5 uppercase tracking-widest`}>En vague / hors line-up</p>
                    <div className="flex flex-wrap gap-2.5">
                      {inFlightSurfers.length > 0 ? inFlightSurfers.map((surfer) => (
                        <button
                          key={surfer}
                          type="button"
                          onClick={() => handlePrioritySurferTap(surfer).catch(() => { })}
                          disabled={!canEditPriority}
                          className={`flex items-center gap-2.5 rounded-xl border border-amber-900/30 bg-amber-950/20 shadow-sm disabled:cursor-default px-3 py-2.5`}
                        >
                          <span className="inline-flex items-center justify-center rounded-md bg-amber-500 font-black text-slate-950 px-2 h-6 text-xs uppercase tracking-wider">
                            Surf
                          </span>
                          <span className="w-3.5 h-3.5 rounded-full border border-slate-950" style={{ backgroundColor: getSurferColor(surfer) }} />
                          <span className="font-extrabold text-slate-100">{surfer}</span>
                        </button>
                      )) : (
                        <div className="rounded-xl border border-dashed border-slate-800 px-4 py-3 text-xs text-slate-500">
                          Aucun surfeur hors line-up.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* CHIEF JUDGE CONTROLS */}
      {isChiefJudge && !priorityOnly && (
        <div className="neon-card border border-white/5 rounded-xl p-4 mt-3 flex-shrink-0 bg-indigo-950/10">
          <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">Contrôles Chef Juge</h3>
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={onHeatClose}
              className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 transition-colors text-xs"
            >
              Clôturer la série
            </button>
            <button className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 font-bold rounded-lg hover:bg-slate-800 transition-colors text-xs">
              Exporter les scores
            </button>
            <button className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 font-bold rounded-lg hover:bg-slate-800 transition-colors text-xs">
              Scores prioritaires
            </button>
          </div>
        </div>
      )}

      {/* LOCK / TIMING FEEDBACK */}
      {!priorityOnly && interactionWarning && (
        <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3 flex items-center space-x-3 mt-3 flex-shrink-0 shadow-lg">
          <Lock className="w-5 h-5 text-red-400 flex-shrink-0 animate-bounce" />
          <div>
            <h3 className="font-extrabold text-red-400 text-xs uppercase tracking-wider">{interactionWarning.title}</h3>
            <p className="text-red-300 text-[11px] leading-tight mt-0.5">{interactionWarning.message}</p>
          </div>
        </div>
      )}

      {/* MAIN JUDGING WORKSPACE */}
      {!priorityOnly && (
        <div className="judge-workspace flex-1 flex flex-col mt-2">
          {/* ENTRY MODE CONTROLS */}
          <div className="flex items-center justify-between flex-wrap gap-2 flex-shrink-0 mb-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEntryMode('score')}
                className={`px-3 py-1 rounded-md text-xs font-bold ${entryMode === 'score' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}
              >
                Notes
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('interference')}
                className={`px-3 py-1 rounded-md text-xs font-bold ${entryMode === 'interference' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}
              >
                Interférence
              </button>
            </div>

            {entryMode === 'interference' && (
              <div className="flex items-center gap-2">
                <select
                  value={interferenceType}
                  onChange={(e) => setInterferenceType(e.target.value as InterferenceType)}
                  className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-md text-xs font-bold text-slate-200 focus:outline-none"
                >
                  <option value="INT1">#1 (B/2)</option>
                  <option value="INT2">#2 (B=0)</option>
                </select>
                {isChiefJudge && (
                  <label className="inline-flex items-center gap-1 text-xs text-slate-400 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={headJudgeOverride}
                      onChange={(e) => setHeadJudgeOverride(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0"
                    />
                    HJ
                  </label>
                )}
              </div>
            )}
          </div>

          {/* SURFER ROWS — scrollable area */}
          <div className="judge-surfer-list flex-1 flex flex-col gap-[var(--judge-row-gap)]">
            {config.surfers.map((surfer) => {
              const isSurferInFlight = inFlightSurfers.includes(normalizeSurferKey(surfer));
              const prioLabel = priorityLabels[normalizeSurferKey(surfer)] || '=';
              const surferColor = getSurferColor(surfer);

              return (
                <div key={surfer} className="judge-surfer-card bg-slate-900/60 rounded-lg border border-slate-800 flex-shrink-0">
                  {/* Surfer header row: color + name + stats */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-4 h-4 rounded flex-shrink-0 border border-slate-700" style={{ backgroundColor: surferColor }} />
                    <span className="judge-surfer-title font-bold text-sm text-slate-100 truncate">{surfer}</span>
                    {prioLabel !== '=' && (
                      <span className="judge-priority-badge" style={getPriorityBadgeStyle(surfer)}>
                        {prioLabel}
                      </span>
                    )}
                    {isSurferInFlight && (
                      <span className="text-[9px] font-bold text-amber-400">SURF</span>
                    )}
                  </div>

                  {/* Wave cells — horizontal row */}
                  <div className="judge-wave-grid">
                    {Array.from({ length: config.waves }, (_, i) => i + 1).map((wave) => {
                      const scoreData = getScoreForWave(surfer, wave);
                      const canScore = canScoreWave(surfer, wave);
                      const isActive = activeInput?.surfer === surfer && activeInput?.wave === wave;
                      const effective = effectiveByTarget.get(`${normalizeSurferKey(surfer)}::${wave}`);

                      let cellClass = "judge-wave-cell inline-flex flex-col items-center justify-center rounded-md font-bold border relative select-none text-xs active:scale-95 touch-manipulation ";

                      if (isActive) {
                        cellClass += "bg-cyan-900/50 text-cyan-300 border-cyan-500";
                      } else if (scoreData) {
                        cellClass += entryMode === 'interference'
                          ? "bg-amber-900/20 text-amber-300 border-amber-800/60"
                          : "bg-emerald-900/20 text-emerald-300 border-emerald-800/40";
                      } else if (canScore) {
                        cellClass += "border border-dashed border-slate-600 text-slate-500 bg-slate-800/30";
                      } else {
                        cellClass += "border-slate-900 text-slate-800 bg-slate-950/20 cursor-not-allowed opacity-20";
                      }

                      return (
                        <button
                          key={wave}
                          type="button"
                          disabled={!isActive && !scoreData && !canScore}
                          onClick={() => handleCellClick(surfer, wave)}
                          className={cellClass}
                        >
                          <span className="text-[7px] font-bold text-slate-600">{wave}</span>
                          <div className="font-mono text-sm leading-none">
                            {isActive ? (
                              <span className="text-cyan-300 font-bold">{inputValue || '—'}</span>
                            ) : scoreData ? (
                              <span className="font-bold">{scoreData.score.toFixed(1)}</span>
                            ) : canScore ? (
                              <span className="text-slate-500">✍</span>
                            ) : (
                              <span className="text-slate-800">—</span>
                            )}
                          </div>
                          {effective && (
                            <span className="absolute -bottom-0.5 text-[6px] font-bold text-amber-500">
                              {effective.type === 'INT1' ? 'I1' : 'I2'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* SCORE INPUT + KEYPAD — always visible at bottom */}
          <div className={`judge-keypad-panel flex-shrink-0 mt-1.5 ${activeInput ? 'is-active' : 'is-idle'}`}>
            {renderScoreInput()}
            <div className="mt-1">
              {renderKeypad()}
            </div>
          </div>
        </div>
      )}

      {/* MODAL NOM DU JUGE */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 text-slate-100">
            <div className="text-center">
              <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-3 border border-indigo-500/40">
                <User className="w-6 h-6 text-indigo-400" />
              </div>
              <h2 className="text-xl font-bold">Bienvenue Juge {judgeId}</h2>
              <p className="text-slate-400 text-sm mt-1">
                Veuillez entrer votre nom pour commencer la notation.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Votre Nom
                </label>
                <input
                  type="text"
                  value={judgeNameInput}
                  onChange={(e) => setJudgeNameInput(e.target.value)}
                  placeholder="Ex: René Laraise"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <button
                onClick={handleNameSubmit}
                disabled={!judgeNameInput.trim() || isSubmittingName}
                className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                {isSubmittingName ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Enregistrement...
                  </>
                ) : (
                  'Commencer à noter'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCORE FEEDBACK TOAST */}
      {scoreFeedback && (
        <div
          key={scoreFeedback.ts}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl shadow-[0_4px_20px_rgba(16,185,129,0.4)] border border-emerald-500/30 font-bold text-lg flex items-center gap-2 animate-score-toast"
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {scoreFeedback.score.toFixed(1)} enregistré !
        </div>
      )}
    </div>
  );
}

export default JudgeInterface;
