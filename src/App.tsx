import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Settings, User, Monitor, Waves, AlertTriangle } from 'lucide-react';

// Components
import AdminInterface from './components/AdminInterface';
import JudgeInterface from './components/JudgeInterface';
import JudgeLogin from './components/JudgeLogin';
import ScoreDisplay from './components/ScoreDisplay';
import SyncStatus from './components/SyncStatus';
import LandingPage from './components/LandingPage';
import CreateEvent from './components/CreateEvent';
import PaymentPage from './components/PaymentPage';
import ParticipantsPage from './components/ParticipantsPage';
import GenerateHeatsPage from './components/GenerateHeatsPage';

// Hooks
import { useSupabaseSync } from './hooks/useSupabaseSync';
import { useRealtimeSync } from './hooks/useRealtimeSync';

// Constants & Types
import { DEFAULT_TIMER_DURATION } from './utils/constants';
import type { AppConfig, Score, HeatTimer, OverrideReason, ScoreOverrideLog } from './types';

const STORAGE_KEYS = {
  config: 'surfJudgingConfig',
  configSaved: 'surfJudgingConfigSaved',
  timer: 'surfJudgingTimer',
  scores: 'surfJudgingScores',
  currentJudge: 'surfJudgingCurrentJudge',
  judgeWorkCount: 'surfJudgingJudgeWorkCount'
} as const;

const SESSION_JUDGE_KEY = STORAGE_KEYS.currentJudge;

type TimerSnapshot = {
  isRunning: boolean;
  startTime: string | null;
  duration: number;
} | null;

interface OverrideRequest {
  judgeId: string;
  judgeName: string;
  surfer: string;
  waveNumber: number;
  newScore: number;
  reason: OverrideReason;
  comment?: string;
}

const INITIAL_CONFIG: AppConfig = {
  competition: '',
  division: '',
  round: 1,
  heatId: 1,
  judges: ['J1', 'J2', 'J3'],
  surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
  waves: 15,
  judgeNames: {},
  tournamentType: 'elimination',
  totalSurfers: 32,
  surfersPerHeat: 4,
  totalHeats: 8,
  totalRounds: 4
};

const DEFAULT_TIMER_STATE: HeatTimer = {
  isRunning: false,
  startTime: null,
  duration: DEFAULT_TIMER_DURATION
};

function normaliseConfig(partial: Partial<AppConfig> | null | undefined): AppConfig {
  if (!partial || typeof partial !== 'object') {
    return { ...INITIAL_CONFIG };
  }

  return {
    ...INITIAL_CONFIG,
    ...partial,
    judges: Array.isArray(partial.judges) && partial.judges.length > 0 ? partial.judges : INITIAL_CONFIG.judges,
    surfers: Array.isArray(partial.surfers) && partial.surfers.length > 0 ? partial.surfers : INITIAL_CONFIG.surfers,
    judgeNames: partial.judgeNames ?? {}
  };
}

function normaliseTimerSnapshot(snapshot: TimerSnapshot): HeatTimer {
  if (!snapshot) {
    return { ...DEFAULT_TIMER_STATE };
  }

  const startTime = snapshot.startTime ? new Date(snapshot.startTime) : null;
  const duration = typeof snapshot.duration === 'number' ? snapshot.duration : DEFAULT_TIMER_DURATION;
  const isRunning = Boolean(snapshot.isRunning) && !!startTime;

  return {
    isRunning,
    startTime,
    duration
  };
}

function parseStoredConfig(raw: string | null): AppConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normaliseConfig(parsed);
  } catch (error) {
    console.error('❌ Erreur parsing configuration locale:', error);
    return null;
  }
}

function parseStoredScores(raw: string | null): Score[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('❌ Erreur parsing scores locaux:', error);
    return [];
  }
}

function parseStoredTimer(raw: string | null): HeatTimer | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normaliseTimerSnapshot(parsed);
  } catch (error) {
    console.error('❌ Erreur parsing timer local:', error);
    return null;
  }
}

function parseStoredJudge(raw: string | null): { id: string; name: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return { id: parsed.id, name: parsed.name || parsed.id };
    }
  } catch (error) {
    console.error('❌ Erreur parsing juge courant:', error);
  }
  return null;
}

function loadJudgeFromSession(): { id: string; name: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_JUDGE_KEY);
    return parseStoredJudge(raw);
  } catch (error) {
    console.error('❌ Erreur lecture juge session:', error);
    return null;
  }
}

function persistJudgeInSession(judge: { id: string; name: string } | null) {
  try {
    if (judge) {
      sessionStorage.setItem(SESSION_JUDGE_KEY, JSON.stringify(judge));
    } else {
      sessionStorage.removeItem(SESSION_JUDGE_KEY);
    }
  } catch (error) {
    console.error('❌ Erreur sauvegarde juge session:', error);
  }
}

function parseStoredWorkCount(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('❌ Erreur parsing compteur juges:', error);
    return {};
  }
}

function persistConfig(config: AppConfig) {
  try {
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
  } catch (error) {
    console.error('❌ Erreur sauvegarde configuration locale:', error);
  }
}

function persistTimer(timer: HeatTimer) {
  try {
    const payload = {
      ...timer,
      startTime: timer.startTime ? timer.startTime.toISOString() : null
    };
    localStorage.setItem(STORAGE_KEYS.timer, JSON.stringify(payload));
  } catch (error) {
    console.error('❌ Erreur sauvegarde timer local:', error);
  }
}

function buildTimerSnapshot(timer: HeatTimer): TimerSnapshot {
  if (!timer.startTime) return null;
  try {
    const startTime = timer.startTime instanceof Date ? timer.startTime : new Date(timer.startTime);
    if (Number.isNaN(startTime.getTime())) {
      return null;
    }

    return {
      isRunning: timer.isRunning,
      startTime: startTime.toISOString(),
      duration: typeof timer.duration === 'number' ? timer.duration : DEFAULT_TIMER_DURATION
    };
  } catch (error) {
    console.error('❌ Erreur construction snapshot timer:', error);
    return null;
  }
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function objectsShallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => a[key] === b[key]);
}

function configsAreEqual(a: AppConfig, b: AppConfig): boolean {
  return (
    a.competition === b.competition &&
    a.division === b.division &&
    a.round === b.round &&
    a.heatId === b.heatId &&
    a.waves === b.waves &&
    a.tournamentType === b.tournamentType &&
    a.totalSurfers === b.totalSurfers &&
    a.surfersPerHeat === b.surfersPerHeat &&
    a.totalHeats === b.totalHeats &&
    a.totalRounds === b.totalRounds &&
    arraysEqual(a.judges, b.judges) &&
    arraysEqual(a.surfers, b.surfers) &&
    objectsShallowEqual(a.judgeNames, b.judgeNames)
  );
}

function timersAreEqual(a: HeatTimer, b: HeatTimer): boolean {
  const startTimeA = a.startTime instanceof Date ? a.startTime.getTime() : a.startTime ? new Date(a.startTime).getTime() : null;
  const startTimeB = b.startTime instanceof Date ? b.startTime.getTime() : b.startTime ? new Date(b.startTime).getTime() : null;
  return (
    a.isRunning === b.isRunning &&
    a.duration === b.duration &&
    startTimeA === startTimeB
  );
}




function App() {
  // State declarations
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  const [configSaved, setConfigSaved] = useState(false);
  const [currentJudge, setCurrentJudge] = useState<{ id: string; name: string } | null>(null);
  const [currentView, setCurrentView] = useState<'admin' | 'judge' | 'display'>('admin');
  const [scores, setScores] = useState<Score[]>([]);
  const [judgeWorkCount, setJudgeWorkCount] = useState<Record<string, number>>({});
  const [overrideLogs, setOverrideLogs] = useState<ScoreOverrideLog[]>([]);
  const [viewLock, setViewLock] = useState<'judge' | 'display' | null>(null);
  
  // Timer state
  const [timer, setTimer] = useState<HeatTimer>({ ...DEFAULT_TIMER_STATE });

  // Hooks
  const { 
    syncStatus, 
    saveScore, 
    createHeat, 
    updateHeatStatus,
    syncPendingScores,
    saveHeatConfig,
    saveTimerState,
    overrideScore,
    loadOverrideLogs
  } = useSupabaseSync();

  const {
    isConnected: realtimeConnected,
    lastUpdate: realtimeLastUpdate,
    error: realtimeError,
    publishTimerStart,
    publishTimerPause,
    publishTimerReset,
    publishConfigUpdate,
    subscribeToHeat,
    fetchRealtimeState
  } = useRealtimeSync();

  // Vérifier les paramètres URL au chargement
  useEffect(() => {
    console.log('🔍 Vérification des paramètres URL...');
    const urlParams = new URLSearchParams(window.location.search);
    console.log('📋 Paramètres URL détectés:', Object.fromEntries(urlParams.entries()));

    const viewParam = urlParams.get('view');
    setViewLock(null);
    if (viewParam && ['admin', 'judge', 'display'].includes(viewParam)) {
      setCurrentView(viewParam as 'admin' | 'judge' | 'display');
      console.log('🎯 Vue définie depuis URL:', viewParam);
    }

    const judgeParam = urlParams.get('judge');
    const configParam = urlParams.get('config');

    if (configParam) {
      try {
        const decodedPayload = JSON.parse(atob(configParam));
        console.log('✅ Payload config décodé:', decodedPayload);

        const { timerSnapshot, configSaved: configSavedFlag, ...configData } = decodedPayload;
        const normalisedConfig = normaliseConfig(configData);

        setConfig(normalisedConfig);
        persistConfig(normalisedConfig);

        const shouldMarkSaved = configSavedFlag !== undefined ? Boolean(configSavedFlag) : true;
        setConfigSaved(shouldMarkSaved);
        localStorage.setItem(STORAGE_KEYS.configSaved, shouldMarkSaved ? 'true' : 'false');

        if (timerSnapshot) {
          const nextTimer = normaliseTimerSnapshot(timerSnapshot);
          setTimer(nextTimer);
          persistTimer(nextTimer);
        }

        if (judgeParam) {
          const judgeName = normalisedConfig.judgeNames[judgeParam] || judgeParam;
          const judge = { id: judgeParam, name: judgeName };
          setCurrentJudge(judge);
          persistJudgeInSession(judge);
          setCurrentView('judge');
          setViewLock('judge');
          console.log('🎯 Juge connecté automatiquement:', judge);
        }
        if (!judgeParam && viewParam === 'display') {
          setViewLock('display');
        }
      } catch (error) {
        console.error('❌ Erreur décodage config URL:', error);
      }
    } else if (judgeParam) {
      setCurrentView('judge');
      setViewLock('judge');
    } else if (viewParam === 'display') {
      setViewLock('display');
    }
  }, []);

  useEffect(() => {
    if (viewLock && currentView !== viewLock) {
      setCurrentView(viewLock);
    }
  }, [viewLock, currentView]);

  // Charger les données depuis localStorage au démarrage
  useEffect(() => {
    console.log('🔄 Chargement des données depuis localStorage...');
    const storedConfig = parseStoredConfig(localStorage.getItem(STORAGE_KEYS.config));
    if (storedConfig) {
      setConfig(storedConfig);
      console.log('✅ Configuration locale chargée:', storedConfig);
    }

    const storedConfigFlag = localStorage.getItem(STORAGE_KEYS.configSaved) === 'true';
    if (storedConfigFlag) {
      setConfigSaved(true);
      console.log('✅ Flag configuration sauvegardée chargé');
    }

    const storedJudge = loadJudgeFromSession();
    if (storedJudge) {
      setCurrentJudge(storedJudge);
      console.log('✅ Juge courant chargé:', storedJudge);
    }

    const storedTimer = parseStoredTimer(localStorage.getItem(STORAGE_KEYS.timer));
    if (storedTimer) {
      setTimer(storedTimer);
      console.log('✅ Timer chargé depuis le cache:', storedTimer);
    }

    const storedScores = parseStoredScores(localStorage.getItem(STORAGE_KEYS.scores));
    if (storedScores.length > 0) {
      setScores(storedScores);
      console.log(`✅ ${storedScores.length} scores chargés depuis le cache`);
    }

    const storedWorkCount = parseStoredWorkCount(localStorage.getItem(STORAGE_KEYS.judgeWorkCount));
    if (Object.keys(storedWorkCount).length > 0) {
      setJudgeWorkCount(storedWorkCount);
      console.log('✅ Compteur travail juges chargé:', storedWorkCount);
    }
  }, []);

  // Réagir aux changements de localStorage provenant d'autres onglets/devices
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (!event.key) return;

      switch (event.key) {
        case STORAGE_KEYS.config: {
          const nextConfig = parseStoredConfig(event.newValue);
          if (nextConfig) {
            setConfig(nextConfig);
          }
          break;
        }
        case STORAGE_KEYS.configSaved: {
          setConfigSaved(event.newValue === 'true');
          break;
        }
        case STORAGE_KEYS.timer: {
          const nextTimer = parseStoredTimer(event.newValue);
          if (nextTimer) {
            setTimer(nextTimer);
          }
          break;
        }
        case STORAGE_KEYS.scores: {
          setScores(parseStoredScores(event.newValue));
          break;
        }
        case STORAGE_KEYS.judgeWorkCount: {
          setJudgeWorkCount(parseStoredWorkCount(event.newValue));
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Réception du fallback timerSync (mode local sans Supabase)
  useEffect(() => {
    const handleTimerSync = (event: Event) => {
      const customEvent = event as CustomEvent<HeatTimer>;
      if (!customEvent.detail) return;

      const snapshot = buildTimerSnapshot(customEvent.detail);
      const nextTimer = normaliseTimerSnapshot(snapshot);
      setTimer(nextTimer);
      persistTimer(nextTimer);
    };

    window.addEventListener('timerSync', handleTimerSync as EventListener);
    return () => window.removeEventListener('timerSync', handleTimerSync as EventListener);
  }, []);

  // Subscription temps réel
  useEffect(() => {
    if (!configSaved || !config.competition) return;

    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    console.log('🔔 Subscription temps réel pour heat:', heatId);

    const unsubscribe = subscribeToHeat(heatId, (newTimer, newConfig) => {
      console.log('📡 Mise à jour temps réel reçue:', { newTimer, newConfig });
      
      if (newTimer) {
        setTimer(newTimer);
        persistTimer(newTimer);
      }
      
      if (newConfig) {
        const parsedConfig = normaliseConfig(newConfig);
        setConfig(parsedConfig);
        persistConfig(parsedConfig);
      }
    });

    return unsubscribe;
  }, [configSaved, config.competition, config.division, config.round, config.heatId, subscribeToHeat]);

  // Charger les logs d'override pour le heat courant
  useEffect(() => {
    if (!configSaved || !config.competition) {
      setOverrideLogs([]);
      return;
    }

    let cancelled = false;
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

    const loadLogs = async () => {
      const logs = await loadOverrideLogs(heatId);
      if (!cancelled) {
        setOverrideLogs(logs);
      }
    };

    loadLogs();

    return () => {
      cancelled = true;
    };
  }, [configSaved, config.competition, config.division, config.round, config.heatId, loadOverrideLogs]);

  // Polling de secours pour récupérer config/timer depuis Supabase (fiabilité mobile)
  useEffect(() => {
    if (!configSaved || !config.competition || !syncStatus.supabaseEnabled) return;

    let cancelled = false;

    const syncFromRealtime = async () => {
      const heatKey = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
      const realtimeState = await fetchRealtimeState(heatKey);
      if (cancelled || !realtimeState) return;

      const remoteConfigRaw = realtimeState.config_data as Partial<AppConfig> | null;
      if (remoteConfigRaw && typeof remoteConfigRaw === 'object') {
        const nextConfig = normaliseConfig(remoteConfigRaw);
        if (!configsAreEqual(nextConfig, config)) {
          setConfig(nextConfig);
          persistConfig(nextConfig);
        }
      }

      const remoteTimer: HeatTimer = {
        isRunning: realtimeState.status === 'running',
        startTime: realtimeState.timer_start_time ? new Date(realtimeState.timer_start_time) : null,
        duration: realtimeState.timer_duration_minutes ?? DEFAULT_TIMER_DURATION
      };

      if (!timersAreEqual(remoteTimer, timer)) {
        setTimer(remoteTimer);
        persistTimer(remoteTimer);
      }
    };

    syncFromRealtime();
    const interval = window.setInterval(syncFromRealtime, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [configSaved, config.competition, config.division, config.round, config.heatId, syncStatus.supabaseEnabled, fetchRealtimeState, config, timer]);

  // Gestionnaires d'événements
  const handleConfigChange = (newConfig: AppConfig) => {
    setConfig(newConfig);
  };

  const handleConfigSaved = async (saved: boolean) => {
    setConfigSaved(saved);
    localStorage.setItem(STORAGE_KEYS.configSaved, saved.toString());

    if (saved) {
      // Créer le heat dans Supabase
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

      try {
        await createHeat({
          competition: config.competition,
          division: config.division,
          round: config.round,
          heat_number: config.heatId,
          status: 'open',
          surfers: config.surfers.map(surfer => ({
            color: surfer,
            name: surfer,
            country: 'SENEGAL'
          }))
        });

        // Sauvegarder la config du heat
        await saveHeatConfig(heatId, config);

        // Publier la config en temps réel
        await publishConfigUpdate(heatId, config);

        console.log('✅ Heat créé et config publiée:', heatId);
      } catch (error) {
        console.log('⚠️ Heat créé en mode local uniquement');
      }

      persistConfig(config);
    }
  };

  const handleScoreSubmit = async (
    scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>
  ): Promise<Score | undefined> => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    
    try {
      const newScore = await saveScore(scoreData, heatId);
      
      // Mettre à jour les scores locaux
      setScores(prev => [...prev, newScore]);
      
      console.log('✅ Score sauvé:', newScore);
      return newScore;
    } catch (error) {
      console.error('❌ Erreur sauvegarde score:', error);
      return undefined;
    }
  };

  const handleScoreOverride = async (request: OverrideRequest): Promise<ScoreOverrideLog | undefined> => {
    if (!configSaved || !config.competition) {
      console.warn('⚠️ Override ignoré: configuration non sauvegardée');
      return undefined;
    }

    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

    try {
      const { updatedScore, log } = await overrideScore({
        heatId,
        competition: config.competition,
        division: config.division,
        round: config.round,
        judgeId: request.judgeId,
        judgeName: request.judgeName,
        surfer: request.surfer,
        waveNumber: request.waveNumber,
        newScore: request.newScore,
        reason: request.reason,
        comment: request.comment
      });

      setScores(prev => {
        const matchIndex = prev.findIndex(
          score =>
            score.heat_id === heatId &&
            score.judge_id === request.judgeId &&
            score.wave_number === request.waveNumber &&
            score.surfer === request.surfer
        );
        if (matchIndex >= 0) {
          const clone = [...prev];
          clone[matchIndex] = updatedScore;
          return clone;
        }
        return [...prev, updatedScore];
      });

      setOverrideLogs(prev => {
        const merged = [log, ...prev.filter(entry => entry.id !== log.id)];
        return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });

      window.dispatchEvent(new CustomEvent('newScoreRealtime', { detail: updatedScore }));

      console.log('✅ Override appliqué:', {
        judge: request.judgeId,
        surfer: request.surfer,
        wave: request.waveNumber,
        newScore: request.newScore,
        reason: request.reason
      });

      return log;
    } catch (error) {
      console.error('❌ Erreur override score:', error);
      return undefined;
    }
  };

  const handleJudgeLogin = (judgeId: string, judgeName: string) => {
    const judge = { id: judgeId, name: judgeName };
    setCurrentJudge(judge);
    persistJudgeInSession(judge);
    console.log('👤 Juge connecté:', judge);
  };

  const handleJudgeLogout = () => {
    setCurrentJudge(null);
    persistJudgeInSession(null);
    console.log('👤 Juge déconnecté');
  };

  const handleTimerChange = (newTimer: HeatTimer) => {
    setTimer(newTimer);
    persistTimer(newTimer);
  };

  const handleReloadData = () => {
    window.location.reload();
  };

  const handleResetAllData = () => {
    console.log('🗑️ RESET COMPLET DE TOUTES LES DONNÉES...');
    
    // Vider localStorage
    localStorage.clear();
    sessionStorage.clear();
    
    // Reset des états
    setConfig({ ...INITIAL_CONFIG });
    setConfigSaved(false);
    setScores([]);
    setCurrentJudge(null);
    setJudgeWorkCount({});
    setTimer({ ...DEFAULT_TIMER_STATE });
    
    console.log('✅ Reset complet terminé');
  };

  const handleCloseHeat = async () => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

    try {
      await updateHeatStatus(heatId, 'closed', new Date().toISOString());
      console.log('✅ Heat fermé:', heatId);
    } catch (error) {
      console.log('⚠️ Heat fermé en mode local uniquement');
    }

    const newWorkCount = { ...judgeWorkCount };
    config.judges.forEach(judgeId => {
      newWorkCount[judgeId] = (newWorkCount[judgeId] || 0) + 1;
    });
    setJudgeWorkCount(newWorkCount);
    localStorage.setItem(STORAGE_KEYS.judgeWorkCount, JSON.stringify(newWorkCount));

    const nextHeatId = config.heatId + 1;
    const newConfig = { ...config, heatId: nextHeatId };
    setConfig(newConfig);
    persistConfig(newConfig);

    const resetTimer = {
      isRunning: false,
      startTime: null,
      duration: DEFAULT_TIMER_DURATION
    };
    setTimer(resetTimer);
    persistTimer(resetTimer);

    setScores([]);
    localStorage.setItem(STORAGE_KEYS.scores, JSON.stringify([]));

    const nextHeatKey = `${newConfig.competition}_${newConfig.division}_R${newConfig.round}_H${newConfig.heatId}`;

    try {
      // Prévenir les clients abonnés à l'ancien heat pour qu'ils basculent sur le nouveau
      await publishConfigUpdate(heatId, newConfig);
      await publishTimerReset(heatId, resetTimer.duration);

      await createHeat({
        competition: newConfig.competition,
        division: newConfig.division,
        round: newConfig.round,
        heat_number: newConfig.heatId,
        status: 'open',
        surfers: newConfig.surfers.map(surfer => ({
          color: surfer,
          name: surfer,
          country: 'SENEGAL'
        }))
      });

      await saveHeatConfig(nextHeatKey, newConfig);
      await saveTimerState(nextHeatKey, resetTimer);
      await publishConfigUpdate(nextHeatKey, newConfig);
      await publishTimerReset(nextHeatKey, resetTimer.duration);
    } catch (error) {
      console.log('⚠️ Synchronisation du nouveau heat différée:', error instanceof Error ? error.message : error);
    }

    console.log(`🏁 Heat ${config.heatId} fermé, passage au heat ${nextHeatId}`);
  };

  const buildSharedUrl = (view: 'admin' | 'judge' | 'display', judgeId?: string | null) => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const timerSnapshot = buildTimerSnapshot(timer);
    const payload = {
      ...config,
      configSaved,
      heatUniqueId: `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`,
      timerSnapshot
    };

    const encodedConfig = btoa(JSON.stringify(payload));
    const url = new URL(baseUrl);
    url.searchParams.set('view', view);
    url.searchParams.set('config', encodedConfig);
    if (judgeId) {
      url.searchParams.set('judge', judgeId);
    }
    return url.toString();
  };

  const openTabInNewWindow = (view: 'admin' | 'judge' | 'display', judgeId?: string | null) => {
    const targetUrl = buildSharedUrl(view, judgeId);
    window.open(targetUrl, '_blank');
  };

  // Rendu conditionnel basé sur la vue
  const renderCurrentView = () => {
    const activeView = viewLock ?? currentView;
    switch (activeView) {
      case 'admin':
        return (
          <AdminInterface
            config={config}
            onConfigChange={handleConfigChange}
            onConfigSaved={handleConfigSaved}
            configSaved={configSaved}
            timer={timer}
            onTimerChange={handleTimerChange}
            onReloadData={handleReloadData}
            onResetAllData={handleResetAllData}
            onCloseHeat={handleCloseHeat}
            judgeWorkCount={judgeWorkCount}
            scores={scores}
            overrideLogs={overrideLogs}
            onScoreOverride={handleScoreOverride}
            onRealtimeTimerStart={publishTimerStart}
            onRealtimeTimerPause={publishTimerPause}
            onRealtimeTimerReset={publishTimerReset}
          />
        );

      case 'judge':
        if (!currentJudge) {
          return (
            <JudgeLogin
              onLogin={handleJudgeLogin}
              availableJudges={config.judges.map(id => ({
                id,
                name: config.judgeNames[id] || id
              }))}
            />
          );
        }
        return (
          <div>
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <User className="w-5 h-5 text-blue-600" />
                <span className="font-medium">Connecté: {currentJudge.name}</span>
              </div>
              <button
                onClick={handleJudgeLogout}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Déconnexion
              </button>
            </div>
            <JudgeInterface
              config={config}
              judgeId={currentJudge.id}
              onScoreSubmit={handleScoreSubmit}
              configSaved={configSaved}
              timer={timer}
            />
          </div>
        );

      case 'display':
        return (
          <ScoreDisplay
            config={config}
            scores={scores}
            timer={timer}
            configSaved={configSaved}
          />
        );

      default:
        return null;
    }
  };

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        {/* Main Routes */}
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/create-event" element={<CreateEvent />} />
          <Route path="/payment" element={<PaymentPage />} />
          <Route path="/participants" element={<ParticipantsPage />} />
          <Route path="/generate-heats" element={<GenerateHeatsPage />} />
          <Route
            path="/chief-judge"
            element={
              <div>
                {/* NAVIGATION */}
                <nav className="bg-white border-b border-gray-200 shadow-sm">
                  <div className="max-w-7xl mx-auto px-4">
                    <div className="flex justify-between items-center h-16">
                      <div className="flex items-center space-x-3">
                        <Waves className="w-8 h-8 text-blue-600" />
                        <h1 className="text-xl font-bold text-gray-900">Surf Judging System</h1>
                      </div>

                      <div className="flex space-x-1">
                        {[
                          { key: 'admin', label: 'Administration', view: 'admin' as const, icon: Settings },
                          { key: 'judge', label: 'Interface Juge', view: 'judge' as const, icon: User },
                          { key: 'display', label: 'Affichage Public', view: 'display' as const, icon: Monitor }
                        ]
                          .map(item => {
                            const Icon = item.icon;
                            const isActive = (viewLock ?? currentView) === item.view;
                            const isDisabled = Boolean(viewLock && item.view !== viewLock);
                            const handleClick = () => {
                              if (isDisabled) return;
                              if (item.view === 'judge') {
                                openTabInNewWindow('judge', currentJudge?.id ?? undefined);
                              } else {
                                openTabInNewWindow(item.view);
                              }
                            };

                            const activeClass = item.view === 'admin'
                              ? 'bg-blue-600 text-white'
                              : item.view === 'judge'
                                ? 'bg-green-600 text-white'
                                : 'bg-purple-600 text-white';

                            return (
                              <button
                                key={item.key}
                                onClick={handleClick}
                                disabled={isDisabled}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                                  isActive
                                    ? activeClass
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                } ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                              >
                                <Icon className="w-4 h-4" />
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                </nav>

                {/* STATUT DE SYNCHRONISATION */}
                <div className="max-w-7xl mx-auto px-4 py-2">
                  <SyncStatus
                    isOnline={syncStatus.isOnline}
                    supabaseEnabled={syncStatus.supabaseEnabled}
                    lastSync={syncStatus.lastSync}
                    pendingScores={syncStatus.pendingScores}
                    syncError={syncStatus.syncError}
                    onManualSync={syncPendingScores}
                    realtimeConnected={realtimeConnected}
                    realtimeLastUpdate={realtimeLastUpdate}
                  />
                </div>

                {/* CONTENU PRINCIPAL */}
                <main className="max-w-7xl mx-auto px-4 py-6">
                  {renderCurrentView()}
                </main>

                {/* ERREURS TEMPS RÉEL */}
                {realtimeError && (
                  <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md">
                    <div className="flex items-center">
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      <div>
                        <strong>Erreur temps réel:</strong>
                        <p className="text-sm">{realtimeError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            }
          />
          <Route path="/judging" element={renderCurrentView()} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
