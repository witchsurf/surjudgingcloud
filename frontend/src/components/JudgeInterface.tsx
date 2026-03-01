import { useState, useEffect, useCallback, useMemo } from 'react';
import { User, Waves, Lock, CreditCard as Edit3, Maximize, Minimize } from 'lucide-react';
import { SURFER_COLORS } from '../utils/constants';
import type { AppConfig, EffectiveInterference, InterferenceCall, InterferenceType, Score, HeatTimer as HeatTimerType } from '../types';
import HeatTimer from './HeatTimer';
import { fetchHeatScores, updateJudgeName, fetchEventIdByName, fetchInterferenceCalls, upsertInterferenceCall } from '../api/supabaseClient';
import { isSupabaseConfigured } from '../lib/supabase';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { computeEffectiveInterferences, summarizeInterferenceBySurfer } from '../utils/interference';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';

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
  onScoreSubmit = async () => { },
  configSaved = false,
  timer = { startTime: null, duration: 20, isRunning: false },
  isChiefJudge = false,
  heatStatus = 'waiting',
  onHeatClose = () => { },
  isConnected = true,
  onScoreSync = async () => ({ success: 0, failed: 0 })
}: JudgeInterfaceProps) {
  const [submittedScores, setSubmittedScores] = useState<Score[]>([]);
  const [activeInput, setActiveInput] = useState<ScoreInputState | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [entryMode, setEntryMode] = useState<'score' | 'interference'>('score');
  const [interferenceType, setInterferenceType] = useState<InterferenceType>('INT1');
  const [headJudgeOverride, setHeadJudgeOverride] = useState(false);
  const [interferenceCalls, setInterferenceCalls] = useState<InterferenceCall[]>([]);
  const [effectiveInterferences, setEffectiveInterferences] = useState<EffectiveInterference[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ message: string; type: 'success' | 'error' | null } | null>(null);

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

  // Judge Name Modal State
  const [showNameModal, setShowNameModal] = useState(false);
  const [judgeNameInput, setJudgeNameInput] = useState('');
  const [isSubmittingName, setIsSubmittingName] = useState(false);

  // Check if judge name is set
  useEffect(() => {
    if (configSaved && config.competition && judgeId) {
      const currentName = config.judgeNames[judgeId];
      // If name is missing or is just the ID (e.g. "J1"), show modal
      if (!currentName || currentName === judgeId) {
        setShowNameModal(true);
      }
    }
  }, [configSaved, config.competition, config.judgeNames, judgeId]);

  const handleNameSubmit = async () => {
    if (!judgeNameInput.trim()) return;

    setIsSubmittingName(true);
    try {
      console.log('📝 Submitting judge name:', judgeNameInput, 'for', judgeId);

      // Get event ID first - gracefully handle if not found
      const eventId = await fetchEventIdByName(config.competition);
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

  const readScoresFromStorage = useCallback((): Score[] => {
    const savedScores = localStorage.getItem('surfJudgingScores');
    if (!savedScores) return [];

    try {
      const parsedScores: Score[] = JSON.parse(savedScores);
      return parsedScores.filter((score) => {
        const sameJudge = score.judge_id === judgeId;
        const sameHeat = currentHeatId ? ensureHeatId(score.heat_id) === currentHeatId : false;
        return sameJudge && sameHeat;
      });
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

  const mergeRealtimeScore = useCallback((incoming: Score) => {
    if (!currentHeatId) return;
    const currentId = ensureHeatId(currentHeatId);
    const incomingId = ensureHeatId(incoming.heat_id);
    if (incomingId !== currentId) return;

    const normalised = { ...incoming, heat_id: incomingId };
    const existing = readAllScoresFromStorage().filter(score => !(
      ensureHeatId(score.heat_id) === incomingId &&
      score.judge_id === normalised.judge_id &&
      score.surfer === normalised.surfer &&
      score.wave_number === normalised.wave_number
    ));
    const merged = [...existing, normalised];
    persistScoresToStorage(merged);
    setSubmittedScores(merged.filter(score => score.heat_id === currentId && score.judge_id === judgeId));
  }, [currentHeatId, judgeId, persistScoresToStorage, readAllScoresFromStorage]);

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
          score.judge_id?.toLowerCase() === judgeId?.toLowerCase()
        );

        setSubmittedScores(displayScores);



      } catch (error) {
        console.warn('Impossible de synchroniser les scores du heat - conservation des données locales', error);
        // Ne PAS purger les données locales en cas d'erreur de connexion
      }
    };

    hydrateHeatScores().catch((error) => {
      console.warn('Erreur hydratation scores', error);
    });
  }, [currentHeatId, judgeId, readAllScoresFromStorage, persistScoresToStorage, readScoresFromStorage]);

  useEffect(() => {
    const handleRealtimeScore = (event: Event) => {
      const custom = event as CustomEvent<Score>;
      if (!custom.detail) return;
      mergeRealtimeScore(custom.detail);
    };

    window.addEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
    return () => window.removeEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
  }, [mergeRealtimeScore]);

  // Vérifier si la saisie est autorisée
  // BLOQUE : avant démarrage (waiting) et après clôture (closed)
  // AUTORISE : pendant (running), en pause (paused), et après expiration (finished)
  const isTimerActive = () => {
    if (!configSaved) return false;
    // Bloquer si le heat est officiellement clos par le chef juge
    if (heatStatus === 'closed') return false;
    // Fallback robuste: si le timer a déjà démarré une fois, on autorise la notation
    // même en cas de statut realtime transitoirement incohérent.
    const heatHasStarted = Boolean(timer?.startTime);
    // Bloquer uniquement si le heat est explicitement en attente ET jamais démarré.
    if (heatStatus === 'waiting' && !heatHasStarted) return false;
    // Autoriser dans tous les autres cas: running, paused, finished
    return true;
  };

  const getScoreForWave = (surfer: string, wave: number) => {
    const surferKey = normalizeSurferKey(surfer);
    return submittedScores.find(
      s =>
        normalizeSurferKey(s.surfer) === surferKey &&
        s.wave_number === wave &&
        s.judge_id === judgeId
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
    if (!timerActive) return;
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
    const eventId = await fetchEventIdByName(config.competition);
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
      surfer: normalizedSurfer,
      wave_number: wave,
      call_type: interferenceType,
      is_head_judge_override: isChiefJudge && headJudgeOverride,
    });
    await refreshInterferenceCalls();
  };

  const handleScoreSubmit = async () => {
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
      const judgeName = config.judgeNames[judgeId] || judgeId;

      const savedScore = await onScoreSubmit({
        competition: config.competition,
        division: config.division,
        round: config.round,
        judge_id: judgeId,
        judge_name: judgeName,
        surfer: activeInput.surfer,
        wave_number: activeInput.wave,
        score: scoreValue
      });

      if (savedScore) {
        const sanitizedScore = {
          ...savedScore,
          heat_id: savedScore.heat_id || currentHeatId,
          judge_id: savedScore.judge_id || judgeId
        };

        if (!currentHeatId || sanitizedScore.heat_id === currentHeatId) {
          // CRITICAL FIX: Persist to localStorage FIRST
          const allScores = readAllScoresFromStorage();
          const withoutDuplicate = allScores.filter(
            (score) => !(
              ensureHeatId(score.heat_id) === ensureHeatId(sanitizedScore.heat_id) &&
              score.judge_id === sanitizedScore.judge_id &&
              normalizeSurferKey(score.surfer) === normalizeSurferKey(sanitizedScore.surfer) &&
              score.wave_number === sanitizedScore.wave_number
            )
          );
          const updatedScores = [...withoutDuplicate, sanitizedScore];
          persistScoresToStorage(updatedScores);

          // THEN update state
          setSubmittedScores(prev => {
            const withoutDuplicate = prev.filter(
              (score) => !(
                normalizeSurferKey(score.surfer) === normalizeSurferKey(sanitizedScore.surfer) &&
                score.wave_number === sanitizedScore.wave_number
              )
            );
            return [...withoutDuplicate, sanitizedScore];
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
  const interferenceBySurfer = useMemo(
    () =>
      summarizeInterferenceBySurfer(
        effectiveInterferences.map((item) => ({
          ...item,
          surfer: normalizeSurferKey(item.surfer),
        }))
      ),
    [effectiveInterferences, normalizeSurferKey]
  );

  return (
    <div className="max-w-full mx-auto px-2 sm:px-6 py-4 space-y-6">
      {/* HEADER JUGE */}
      <div className={`bg-gradient-to-r ${isChiefJudge
        ? 'from-purple-600 to-indigo-600'
        : 'from-green-600 to-emerald-600'
        } text-white rounded-xl p-6 shadow-lg`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {isChiefJudge ? 'Interface Chef Juge' : 'Interface Juge'}
              {!isConnected && (
                <span className="ml-4 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  <span className="w-2 h-2 mr-1.5 bg-red-500 rounded-full animate-pulse"></span>
                  Hors Ligne
                </span>
              )}
            </h1>
            <div className="flex items-center space-x-4 text-green-100">
              <span className="flex items-center">
                <User className="w-4 h-4 mr-1" />
                {config.judgeNames[judgeId] || judgeId}
                {isChiefJudge && <span className="ml-2 px-2 py-0.5 bg-purple-500 rounded-full text-xs">Chef Juge</span>}
              </span>
              <span>{config.competition}</span>
              <span>{config.division}</span>
              <span>R{config.round} - H{config.heatId}</span>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={toggleFullscreen}
              className="flex items-center space-x-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm font-medium border border-white/10 shadow-sm"
              title={isFullscreen ? "Quitter le plein écran" : "Passer en plein écran"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5 text-white" /> : <Maximize className="w-5 h-5 text-white" />}
              <span className="hidden sm:inline font-semibold">{isFullscreen ? 'Réduire' : 'Plein Écran'}</span>
            </button>

            {/* SYNC BUTTON */}
            <button
              onClick={async () => {
                setIsSyncing(true);
                setSyncFeedback(null);
                try {
                  const result = await onScoreSync();
                  setSyncFeedback({ 
                    message: `${result.success} notes synchronisées`, 
                    type: 'success' 
                  });
                  // Auto-clear success message after 3s
                  setTimeout(() => setSyncFeedback(null), 3000);
                } catch (error) {
                  setSyncFeedback({ 
                    message: error instanceof Error ? error.message : 'Erreur de synchronisation', 
                    type: 'error' 
                  });
                } finally {
                  setIsSyncing(false);
                }
              }}
              disabled={isSyncing || !isConnected}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all text-sm font-medium border shadow-sm ${
                isSyncing 
                  ? 'bg-white/10 text-white/50 border-white/5 cursor-not-allowed' 
                  : 'bg-white/20 hover:bg-white/30 text-white border-white/10 active:scale-95'
              }`}
              title="Forcer la synchronisation des notes de cette série vers le cloud"
            >
              <div className={`w-5 h-5 flex items-center justify-center ${isSyncing ? 'animate-spin' : ''}`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <span className="hidden sm:inline font-semibold">
                {isSyncing ? 'En cours...' : 'Synchroniser'}
              </span>
            </button>
          </div>
        </div>
        
        {/* SYNC FEEDBACK BANNER */}
        {syncFeedback && (
          <div className={`mt-4 p-2 rounded-lg text-xs font-bold flex items-center justify-center animate-in fade-in slide-in-from-top-2 ${
            syncFeedback.type === 'success' ? 'bg-green-500/30 text-green-100 border border-green-500/50' : 'bg-red-500/30 text-red-100 border border-red-500/50'
          }`}>
            {syncFeedback.type === 'success' ? '✅' : '❌'} {syncFeedback.message}
          </div>
        )}
      </div>

      {/* TIMER */}
      <div className="flex justify-center">
        <HeatTimer
          timer={timer}
          onStart={() => { }}
          onPause={() => { }}
          onReset={() => { }}
          onDurationChange={() => { }}
          showControls={isChiefJudge}
          size="medium"
          configSaved={configSaved}
        />
      </div>

      {/* CONTRÔLES CHEF JUGE */}
      {isChiefJudge && (
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
      {!timerActive && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-3">
          <Lock className="w-6 h-6 text-red-600" />
          <div>
            {heatStatus === 'waiting' && !timer?.startTime ? (
              <>
                <h3 className="font-semibold text-red-800">Timer Non Démarré - Notation Bloquée</h3>
                <p className="text-red-700 text-sm">
                  Attendez que le chef juge démarre le timer avant de noter les vagues.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-red-800">Heat Clos - Notation Bloquée</h3>
                <p className="text-red-700 text-sm">
                  La notation est désactivée car le heat a été clôturé par le chef juge.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* GRILLE DE NOTATION */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <Waves className="w-6 h-6 mr-2 text-blue-600" />
            Grille de notation - {config.waves} vagues maximum
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Cliquez sur une case pour noter. Les vagues doivent être notées dans l'ordre.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
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

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 sticky left-0 bg-gray-50">
                  Surfeur
                </th>
                {Array.from({ length: config.waves }, (_, i) => i + 1).map(wave => (
                  <th key={wave} className="px-3 py-3 text-center text-sm font-semibold text-gray-900 min-w-[60px]">
                    V{wave}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {config.surfers.map((surfer, index) => (
                <tr key={surfer} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 sticky left-0 bg-inherit">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: getSurferColor(surfer) }}
                      />
                      <span className="font-semibold text-gray-900">{surfer}</span>
                    </div>
                  </td>
                  {Array.from({ length: config.waves }, (_, i) => i + 1).map(wave => {
                    const scoreData = getScoreForWave(surfer, wave);
                    const canScore = timerActive && canScoreWave(surfer, wave);
                    const isActive = activeInput?.surfer === surfer && activeInput?.wave === wave;
                    const effective = effectiveByTarget.get(`${normalizeSurferKey(surfer)}::${wave}`);

                    return (
                      <td key={wave} className="px-3 py-3 text-center">
                        {isActive ? (
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.01"
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
                            className="w-20 min-w-[44px] min-h-[44px] px-2 py-2 text-center text-lg font-bold border-2 border-primary rounded-lg focus:outline-none focus:ring-4 focus:ring-primary/30 shadow-sm touch-manipulation"
                            placeholder="0.00"
                            autoFocus
                          />
                        ) : scoreData ? (
                          <button
                            onClick={() => handleCellClick(surfer, wave)}
                            className={`inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-3 py-2 rounded-lg text-base font-bold transition-all duration-200 shadow-sm active:scale-95 touch-manipulation flex-1 w-full ${entryMode === 'interference'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                              : 'bg-green-100 text-green-900 border border-green-300 hover:bg-green-200'}`}
                            disabled={!timerActive}
                          >
                            {scoreData.score.toFixed(2)}
                            <Edit3 className="w-4 h-4 ml-1.5" />
                          </button>
                        ) : canScore ? (
                          <button
                            onClick={() => handleCellClick(surfer, wave)}
                            className="w-full min-w-[44px] min-h-[44px] border-2 border-dashed border-gray-400 rounded-lg text-gray-500 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all duration-200 flex items-center justify-center active:scale-95 touch-manipulation"
                            title={`Noter la vague ${wave} pour ${surfer}`}
                          >
                            <Edit3 className="w-5 h-5 flex-shrink-0" />
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
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

        {/* LÉGENDE */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-dashed border-blue-300 rounded"></div>
              <span className="text-gray-600">Prochaine vague à noter</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs">7.50</span>
              <span className="text-gray-600">Score déjà noté (cliquez pour modifier)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-gray-400">—</span>
              <span className="text-gray-600">Vague non disponible</span>
            </div>
          </div>
          <p className="text-center text-xs text-gray-500 mt-2">
            {entryMode === 'interference'
              ? '⚠️ Mode interférence: choisissez le type puis cliquez la note/vague du surfeur fautif.'
              : '⚠️ Les vagues doivent être notées dans l\'ordre séquentiel pour chaque surfeur'}
          </p>
        </div>
      </div>

      {effectiveInterferences.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-2">Interférences effectives (majorité / Head Judge)</h3>
          <ul className="space-y-1 text-sm text-amber-800">
            {config.surfers.map((surfer) => {
              const summary = interferenceBySurfer.get(normalizeSurferKey(surfer));
              if (!summary) return null;
              return (
                <li key={surfer}>
                  <strong>{surfer}</strong>: {summary.isDisqualified
                    ? 'DSQ (2 interférences confirmées)'
                    : summary.type === 'INT1'
                      ? 'Interférence #1 active (B/2)'
                      : 'Interférence #2 active (B=0)'}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* RÉSUMÉ DES SCORES */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Mes scores soumis ({submittedScores.length})
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {config.surfers.map(surfer => {
            const surferScores = submittedScores.filter(
              (s) => normalizeSurferKey(s.surfer) === normalizeSurferKey(surfer)
            );
            const nextWave = getNextAvailableWave(surfer);

            return (
              <div key={surfer} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getSurferColor(surfer) }}
                  />
                  <span className="font-medium text-gray-900">{surfer}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {surferScores.length} vague{surferScores.length > 1 ? 's' : ''} notée{surferScores.length > 1 ? 's' : ''}
                </div>
                {nextWave <= config.waves && (
                  <div className="text-xs text-blue-600 mt-1">
                    Prochaine: V{nextWave}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
