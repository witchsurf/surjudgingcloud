import { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { User, Waves, Lock, CreditCard as Edit3, Maximize, Minimize } from 'lucide-react';
import { SURFER_COLORS } from '../utils/constants';
import type { AppConfig, EffectiveInterference, InterferenceCall, InterferenceType, PriorityState, Score, HeatTimer as HeatTimerType } from '../types';
import HeatTimer from './HeatTimer';
import { fetchHeatScores, updateJudgeName, fetchEventIdByName, fetchHeatMetadata, fetchInterferenceCalls, upsertInterferenceCall } from '../api/supabaseClient';
import { isSupabaseConfigured } from '../lib/supabase';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { computeEffectiveInterferences } from '../utils/interference';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { buildEqualPriorityState, getPriorityLabels, normalizePriorityState, promoteOpeningToOrdered, removePrioritySurfer, returnPrioritySurfer, setPriorityOrder } from '../utils/priority';
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
  const activeInputRef = useRef<HTMLInputElement | null>(null);

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
  const refetchSocreOverrides = useCallback(async () => {
    if (!currentHeatId || !judgeId) return;
    try {
      console.log('🔄 Re-syncing scores after admin override...');
      const dbScores = await fetchHeatScores(currentHeatId);
      const myScores = dbScores.filter(s => 
        (s.judge_id === judgeId || (s.judge_station || s.judge_id) === judgeStation) &&
        ensureHeatId(s.heat_id) === ensureHeatId(currentHeatId)
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
    }
  }, [currentHeatId, judgeId, judgeStation, persistScoresToStorage]);

  useEffect(() => {
    const handleOverride = (e: any) => {
      const { heatId: targetHeatId } = e.detail || {};
      if (ensureHeatId(targetHeatId) === ensureHeatId(currentHeatId)) {
        refetchSocreOverrides();
      }
    };
    window.addEventListener('scoreOverrideApplied', handleOverride);
    return () => window.removeEventListener('scoreOverrideApplied', handleOverride);
  }, [currentHeatId, refetchSocreOverrides]);

  useEffect(() => {
    if (!currentHeatId || !isSupabaseConfigured()) return () => { };
    return subscribeToHeatScores(currentHeatId, () => {
      refetchSocreOverrides().catch((err) => {
        console.warn('Failed to refetch judge scores after shared heat update:', err);
      });
    });
  }, [currentHeatId, refetchSocreOverrides]);


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

    if (!canScoreWave(surfer, wave)) return;

    const existingScore = getScoreForWave(surfer, wave);
    setActiveInput({ surfer, wave, value: existingScore?.score.toString() || '' });
    setInputValue(existingScore?.score.toString() || '');
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

    const scoreValue = parseFloat(inputValue.replace(',', '.'));
    if (isNaN(scoreValue) || scoreValue < 0 || scoreValue > 10) {
      alert('Le score doit être entre 0 et 10');
      return;
    }

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

  if (!configSaved) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center">
          <Waves className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-blue-800 mb-2">En attente de configuration</h2>
          <p className="text-blue-700">
            L'interface de notation sera disponible une fois la compétition configurée.
          </p>
        </div>
      </div>
    );
  }

  const timerActive = isTimerActive();
  const effectiveByTarget = useMemo(() => {
    const map = new Map<string, EffectiveInterference>();
    effectiveInterferences.forEach((item) => {
      map.set(`${normalizeSurferKey(item.surfer)}::${item.waveNumber}`, item);
    });
    return map;
  }, [effectiveInterferences, normalizeSurferKey]);

  const priorityShellClass = priorityOnly
    ? 'min-h-screen max-w-5xl mx-auto px-3 sm:px-5 md:px-6 py-3 sm:py-4 flex flex-col overflow-hidden'
    : 'h-screen max-w-full mx-auto px-2 sm:px-4 py-2 flex flex-col overflow-hidden';

  const priorityCardPadding = priorityOnly ? 'p-4 sm:p-5' : 'p-2 sm:p-3';

  return (
    <div className={priorityShellClass}>
      {/* HEADER + TIMER */}
      <div className={isFullscreen ? 'sticky top-3 z-40' : ''}>
        <div className={`bg-gradient-to-r from-violet-700 via-primary-700 to-indigo-700 text-white rounded-xl shadow-lg ${priorityCardPadding}`}>
          <div className={`flex items-center justify-between ${priorityOnly ? 'gap-3 sm:gap-5' : 'gap-4'}`}>
            <div className={`flex items-center justify-between flex-1 min-w-0 ${priorityOnly ? 'gap-3 sm:gap-6' : 'gap-4'}`}>
              <div className="min-w-0">
                <h1 className={`${priorityOnly ? 'text-xl sm:text-2xl md:text-3xl' : 'text-lg sm:text-xl'} font-bold flex items-center gap-2 truncate`}>
                  {resolvedInterfaceTitle}
                  {!isConnected && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-red-100 text-red-800">
                      Hors Ligne
                    </span>
                  )}
                </h1>
                <div className={`flex items-center gap-x-3 text-violet-100 opacity-90 flex-wrap ${priorityOnly ? 'text-xs sm:text-sm mt-1.5' : 'text-[10px]'}`}>
                  <span className={`font-semibold truncate ${priorityOnly ? 'max-w-[160px] sm:max-w-[220px]' : 'max-w-[100px]'}`}>{config.judgeNames[judgeId] || judgeName || judgeId}</span>
                  <span className={`${priorityOnly ? 'max-w-[180px] sm:max-w-[260px]' : 'max-w-[100px]'} truncate`}>{config.competition}</span>
                  <span className={`font-semibold uppercase truncate ${priorityOnly ? 'max-w-[160px] sm:max-w-[220px]' : 'max-w-[100px]'}`}>{config.division || 'Sans categorie'}</span>
                  <span className="font-bold">R{config.round} H{config.heatId}</span>
                </div>
              </div>

              <div className="flex-shrink-0">
                <HeatTimer
                  timer={timer}
                  onStart={() => { }}
                  onPause={() => { }}
                  onReset={() => { }}
                  onDurationChange={() => { }}
                  showControls={isChiefJudge}
                  size={priorityOnly ? 'medium' : 'small'}
                  landscape={true}
                  embedded={true}
                  configSaved={configSaved}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                      } catch (error) {
                        setSyncFeedback({
                          message: 'Erreur',
                          type: 'error'
                        });
                      } finally {
                        setIsSyncing(false);
                      }
                    }}
                    disabled={isSyncing || !isConnected}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg transition-all text-xs font-medium border shadow-sm ${isSyncing
                      ? 'bg-white/10 text-white/50 border-white/5'
                      : 'bg-white/20 hover:bg-white/30 text-white border-white/10 active:scale-95'
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
                    <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full border border-white animate-pulse">
                      {pendingSyncCount}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={toggleFullscreen}
                className={`flex items-center space-x-1 bg-white/20 hover:bg-white/30 rounded-lg transition-colors font-medium border border-white/10 ${priorityOnly ? 'px-3.5 py-2 text-sm' : 'px-3 py-1.5 text-xs'}`}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                <span className="hidden sm:inline">{isFullscreen ? 'Réduire' : 'Plein Écran'}</span>
              </button>
            </div>
          </div>

          {!priorityOnly && syncFeedback && (
            <div className={`px-3 py-1 rounded bg-white/10 text-[10px] font-bold inline-flex items-center absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap z-50 ${syncFeedback.type === 'success' ? 'text-green-300' : 'text-red-300'
              }`}>
              {syncFeedback.type === 'success' ? '✅' : '❌'} {syncFeedback.message}
            </div>
          )}
        </div>
      </div>

      {heatStatus === 'closed' && (
        <div className="mt-3 rounded-xl border-4 border-primary-950 bg-red-600 px-6 py-4 text-center shadow-block flex-shrink-0">
          <div className="font-bebas text-3xl sm:text-4xl tracking-[0.25em] text-white leading-none">
            HEAT OVER
          </div>
        </div>
      )}

      {(priorityOnly || canEditPriority) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-shrink-0">
          <div className={`bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3 ${priorityOnly ? 'px-4 py-3 sm:px-5' : 'px-3 py-1.5'}`}>
            <div>
              <h2 className={`${priorityOnly ? 'text-2xl sm:text-3xl' : 'text-lg'} font-bold text-gray-900 leading-tight`}>Priorité</h2>
              <p className={`${priorityOnly ? 'text-xs sm:text-sm mt-1' : 'text-[10px]'} text-gray-600 leading-tight`}>
                {priorityState.mode === 'equal'
                  ? 'Début de série: tous les surfeurs sont égaux.'
                  : priorityState.mode === 'opening'
                    ? 'Phase initiale: chaque premier départ construit la priorité par la fin.'
                    : 'Touchez un surfeur quand il part ou revient.'}
              </p>
            </div>
            {canEditPriority && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePriorityResetEqual().catch(() => { })}
                  className={`rounded-lg bg-indigo-600 font-medium text-white hover:bg-indigo-700 ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-2 text-sm'}`}
                >
                  Egalite
                </button>
                {isPriorityOrdering ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPriorityOrdering(false);
                        setPriorityDraft([]);
                      }}
                      className={`rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50 ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-2 text-sm'}`}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePriorityOrderSave().catch(() => { })}
                      disabled={orderedDraft.length !== normalizedSurfers.length}
                      className={`rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-2 text-sm'}`}
                    >
                      Valider l&apos;ordre
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handlePriorityOrderStart}
                    className={`rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50 ${priorityOnly ? 'px-4 py-2.5 text-base' : 'px-3 py-2 text-sm'}`}
                  >
                    Definir l&apos;ordre
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={`${priorityOnly ? 'p-4 sm:p-5 space-y-5' : 'p-2 sm:p-3 space-y-3'}`}>
            {isPriorityOrdering ? (
              <>
                <div>
                  <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-sm'} font-semibold text-gray-800 mb-3`}>Touchez les surfeurs dans l&apos;ordre P, 2, 3, 4.</p>
                  <div className="flex flex-wrap gap-3">
                    {availableDraftSurfers.map((surfer) => (
                      <button
                        key={surfer}
                        type="button"
                        onClick={() => handlePriorityDraftAdd(surfer)}
                        className={`flex items-center gap-2 rounded-lg border border-gray-300 bg-white shadow-sm hover:border-indigo-400 hover:bg-indigo-50 transition-colors ${priorityOnly ? 'px-4 py-3 text-lg' : 'px-3 py-2'}`}
                      >
                        <span className={`${priorityOnly ? 'w-5 h-5' : 'w-4 h-4'} rounded-full border border-gray-300`} style={{ backgroundColor: getSurferColor(surfer) }} />
                        <span className="font-semibold text-gray-900">{surfer}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-sm'} font-semibold text-gray-800 mb-3`}>Ordre en cours</p>
                  <div className="flex flex-wrap gap-3">
                    {orderedDraft.length > 0 ? orderedDraft.map((surfer, index) => (
                      <button
                        key={surfer}
                        type="button"
                        onClick={() => handlePriorityDraftRemove(surfer)}
                        className={`flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 shadow-sm ${priorityOnly ? 'px-4 py-3 text-lg' : 'px-3 py-2'}`}
                      >
                        <span className={`inline-flex justify-center rounded-full bg-indigo-600 font-bold text-white ${priorityOnly ? 'min-w-[2.5rem] px-3 py-1.5 text-base' : 'min-w-[2rem] px-2 py-1 text-sm'}`}>
                          {index === 0 ? 'P' : index + 1}
                        </span>
                        <span className={`${priorityOnly ? 'w-5 h-5' : 'w-4 h-4'} rounded-full border border-gray-300`} style={{ backgroundColor: getSurferColor(surfer) }} />
                        <span className="font-semibold text-gray-900">{surfer}</span>
                      </button>
                    )) : (
                      <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
                        Aucun ordre defini pour l&apos;instant.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-sm'} font-semibold text-gray-800 mb-3`}>
                    {priorityState.mode === 'equal' ? 'Tous egaux' : priorityState.mode === 'opening' ? 'Phase initiale' : 'Line-up'}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {(priorityState.mode === 'equal' ? normalizedSurfers : priorityState.mode === 'opening' ? normalizedSurfers : orderedPrioritySurfers).map((surfer) => (
                      <button
                        key={surfer}
                        type="button"
                        onClick={() => handlePrioritySurferTap(surfer).catch(() => { })}
                        disabled={!canEditPriority}
                        className={`flex items-center gap-2 rounded-lg border border-gray-300 bg-white shadow-sm disabled:cursor-default ${priorityOnly ? 'px-4 py-3 text-lg' : 'px-3 py-2'}`}
                      >
                        <span className={`inline-flex justify-center rounded-full font-bold ${priorityState.mode === 'equal' ? 'bg-gray-200 text-gray-700' : 'bg-indigo-600 text-white'} ${priorityOnly ? 'min-w-[2.5rem] px-3 py-1.5 text-base' : 'min-w-[2rem] px-2 py-1 text-sm'}`}>
                          {priorityLabels[surfer] || '='}
                        </span>
                        <span className={`${priorityOnly ? 'w-5 h-5' : 'w-4 h-4'} rounded-full border border-gray-300`} style={{ backgroundColor: getSurferColor(surfer) }} />
                        <span className="font-semibold text-gray-900">{surfer}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {priorityState.mode === 'ordered' && (
                  <div>
                    <p className={`${priorityOnly ? 'text-base sm:text-lg' : 'text-sm'} font-semibold text-gray-800 mb-3`}>En vague / hors line-up</p>
                    <div className="flex flex-wrap gap-3">
                      {inFlightSurfers.length > 0 ? inFlightSurfers.map((surfer) => (
                        <button
                          key={surfer}
                          type="button"
                          onClick={() => handlePrioritySurferTap(surfer).catch(() => { })}
                          disabled={!canEditPriority}
                          className={`flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 shadow-sm disabled:cursor-default ${priorityOnly ? 'px-4 py-3 text-lg' : 'px-3 py-2'}`}
                        >
                          <span className={`inline-flex justify-center rounded-full bg-amber-500 font-bold text-white ${priorityOnly ? 'min-w-[2.5rem] px-3 py-1.5 text-base' : 'min-w-[2rem] px-2 py-1 text-sm'}`}>
                            Surf
                          </span>
                          <span className={`${priorityOnly ? 'w-5 h-5' : 'w-4 h-4'} rounded-full border border-gray-300`} style={{ backgroundColor: getSurferColor(surfer) }} />
                          <span className="font-semibold text-gray-900">{surfer}</span>
                        </button>
                      )) : (
                        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
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

      {/* CONTRÔLES CHEF JUGE */}
      {isChiefJudge && !priorityOnly && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 mb-4">
          <h3 className="text-lg font-semibold text-indigo-900 mb-4">Contrôles Chef Juge</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={onHeatClose}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Clôturer la série
            </button>
            <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
              Exporter les scores
            </button>
            <button className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors">
              Scores prioritaires
            </button>
          </div>
          <div className="mt-4 text-sm text-indigo-700">
            <p>👉 En tant que chef juge, vous pouvez contrôler le timer et gérer le déroulement de la série</p>
          </div>
        </div>
      )}

      {/* STATUT SAISIE */}
      {!priorityOnly && interactionWarning && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-3">
          <Lock className="w-6 h-6 text-red-600" />
          <div>
            <h3 className="font-semibold text-red-800">{interactionWarning.title}</h3>
            <p className="text-red-700 text-sm">{interactionWarning.message}</p>
          </div>
        </div>
      )}

      {/* GRILLE DE NOTATION */}
      {!priorityOnly && (
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-2">
          <div className={`bg-gray-50 border-b border-gray-200 ${compactGrid ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEntryMode('score')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${entryMode === 'score' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
              >
                Mode notes
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('interference')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${entryMode === 'interference' ? 'bg-amber-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
              >
                Mode interférence
              </button>
              {entryMode === 'interference' && (
                <>
                  <select
                    value={interferenceType}
                    onChange={(e) => setInterferenceType(e.target.value as InterferenceType)}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
                  >
                    <option value="INT1">Interférence #1 (B/2)</option>
                    <option value="INT2">Interférence #2 (B=0)</option>
                  </select>
                  {isChiefJudge && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={headJudgeOverride}
                        onChange={(e) => setHeadJudgeOverride(e.target.checked)}
                      />
                      Arbitrage Head Judge
                    </label>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className={`w-full table-fixed ${compactGrid ? 'text-sm' : ''}`}>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className={`${compactGrid ? 'px-1 py-1 text-[10px] min-w-[36px] w-9' : 'px-2 py-2 text-xs min-w-[48px] w-12'} text-center font-bold text-gray-500 uppercase tracking-wider`}>
                    Prio
                  </th>
                  <th className={`${compactGrid ? 'px-2 py-1.5 text-xs w-24' : 'px-3 py-2 text-sm w-32'} text-left font-bold text-gray-900 sticky left-0 bg-gray-50 z-10`}>
                    Surfeur
                  </th>
                  {Array.from({ length: config.waves }, (_, i) => i + 1).map(wave => (
                    <th key={wave} className={`${ultraCompactGrid ? 'px-0.5 py-1 text-[10px]' : compactGrid ? 'px-1 py-1.5 text-xs' : 'px-2 py-2 text-sm'} text-center font-bold text-gray-900 ${ultraCompactGrid ? 'min-w-[34px]' : compactGrid ? 'min-w-[42px]' : 'min-w-[50px]'}`}>
                      V{wave}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {config.surfers.map((surfer, index) => (
                  <tr key={surfer} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className={`${compactGrid ? 'px-1 py-1' : 'px-2 py-2'} text-center h-16 sm:h-20`}>
                      <div className={`mx-auto flex items-center justify-center rounded-lg border font-bold ${inFlightSurfers.includes(normalizeSurferKey(surfer))
                        ? 'border-gray-200 bg-white text-transparent'
                        : 'border-gray-300 bg-gray-50 text-gray-900'
                        } ${ultraCompactGrid ? 'min-h-[32px] min-w-[32px] text-[10px]' : compactGrid ? 'min-h-[36px] min-w-[36px] text-xs' : 'min-h-[40px] min-w-[40px] text-sm'}`}>
                        {inFlightSurfers.includes(normalizeSurferKey(surfer)) ? '' : (priorityLabels[normalizeSurferKey(surfer)] || '=')}
                      </div>
                    </td>
                    <td className={`${compactGrid ? 'px-2 py-1.5' : 'px-3 py-2'} sticky left-0 bg-inherit z-10 border-r border-gray-100`}>
                      <div className={`flex items-center ${compactGrid ? 'space-x-1.5' : 'space-x-2'} min-w-0`}>
                        <div
                          className={`${compactGrid ? 'w-3.5 h-3.5' : 'w-4 h-4'} rounded-full flex-shrink-0`}
                          style={{ backgroundColor: getSurferColor(surfer) }}
                        />
                        <span className={`font-semibold text-gray-900 truncate ${compactGrid ? 'text-sm' : ''}`}>{surfer}</span>
                      </div>
                    </td>
                    {Array.from({ length: config.waves }, (_, i) => i + 1).map(wave => {
                      const scoreData = getScoreForWave(surfer, wave);
                      const canScore = canScoreWave(surfer, wave);
                      const isActive = activeInput?.surfer === surfer && activeInput?.wave === wave;
                      const effective = effectiveByTarget.get(`${normalizeSurferKey(surfer)}::${wave}`);

                      return (
                        <td key={wave} className={`${ultraCompactGrid ? 'px-0.5 py-1' : compactGrid ? 'px-1 py-1.5' : 'px-2 py-2'} text-center`}>
                          {isActive ? (
                            <input
                              ref={activeInputRef}
                              type="number"
                              min="0"
                              max="10"
                              step="0.01"
                              inputMode="decimal"
                              enterKeyHint="done"
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              onKeyDown={handleKeyPress}
                              onBlur={() => {
                                if (inputValue.trim()) {
                                  handleScoreSubmit();
                                } else {
                                  setActiveInput(null);
                                  setInputValue('');
                                }
                              }}
                              className={`${ultraCompactGrid ? 'w-full min-w-[34px] min-h-[32px] text-sm px-1 py-1' : compactGrid ? 'w-full min-w-[38px] min-h-[36px] text-base px-1 py-1.5' : 'w-16 min-w-[42px] min-h-[40px] text-lg px-1.5 py-2'} text-center font-bold border-2 border-primary rounded-lg focus:outline-none focus:ring-4 focus:ring-primary/30 shadow-sm touch-manipulation`}
                              placeholder="0.00"
                              autoFocus
                            />
                          ) : scoreData ? (
                            <button
                              onClick={() => handleCellClick(surfer, wave)}
                              className={`inline-flex items-center justify-center rounded-lg font-bold transition-all duration-200 shadow-sm active:scale-95 touch-manipulation flex-1 w-full ${ultraCompactGrid ? 'min-w-[34px] min-h-[32px] px-0.5 py-0.5 text-xs' : compactGrid ? 'min-w-[38px] min-h-[36px] px-1 py-1 text-sm' : 'min-w-[42px] min-h-[40px] px-2 py-1.5 text-sm'} ${entryMode === 'interference'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                                : 'bg-green-100 text-green-900 border border-green-300 hover:bg-green-200'}`}
                            >
                              {scoreData.score.toFixed(2)}
                              {!ultraCompactGrid && !compactGrid && <Edit3 className="w-4 h-4 ml-1" />}
                            </button>
                          ) : canScore ? (
                            <button
                              onClick={() => handleCellClick(surfer, wave)}
                              className={`w-full border-2 border-dashed border-gray-400 rounded-lg text-gray-500 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all duration-200 flex items-center justify-center active:scale-95 touch-manipulation ${ultraCompactGrid ? 'min-w-[34px] min-h-[32px]' : compactGrid ? 'min-w-[38px] min-h-[36px]' : 'min-w-[42px] min-h-[40px]'}`}
                              title={`Noter la vague ${wave} pour ${surfer}`}
                            >
                              <Edit3 className={`${compactGrid ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0`} />
                            </button>
                          ) : (
                            <span className={`${compactGrid ? 'text-xs' : 'text-sm'} text-gray-400`}>—</span>
                          )}
                          {effective && (
                            <div className="mt-1 text-[10px] font-semibold text-amber-700">
                              {effective.type === 'INT1' ? 'INT#1' : 'INT#2'} {effective.source === 'head_judge' ? '(HJ)' : ''}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL NOM DU JUGE */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <User className="w-6 h-6 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Bienvenue Juge {judgeId}</h2>
              <p className="text-gray-500 text-sm mt-1">
                Veuillez entrer votre nom pour commencer la notation.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Votre Nom
                </label>
                <input
                  type="text"
                  value={judgeNameInput}
                  onChange={(e) => setJudgeNameInput(e.target.value)}
                  placeholder="Ex: René Laraise"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>

              <button
                onClick={handleNameSubmit}
                disabled={!judgeNameInput.trim() || isSubmittingName}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
    </div>
  );
}

export default JudgeInterface;
