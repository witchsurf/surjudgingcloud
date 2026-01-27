import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { DEFAULT_TIMER_DURATION, HEAT_COLOR_CACHE_KEY } from './utils/constants';
import type { AppConfig, Score, HeatTimer, OverrideReason, ScoreOverrideLog } from './types';
import {
  fetchOrderedHeatSequence,
  fetchHeatEntriesWithParticipants,
  fetchHeatSlotMappings,
  replaceHeatEntries,
  fetchLatestEventConfig,
  updateEventConfiguration,
  fetchDistinctDivisions,
  fetchEventConfigSnapshot,
  saveEventConfigSnapshot,
  fetchHeatMetadata,
} from './api/supabaseClient';
import { isSupabaseConfigured } from './lib/supabase';
import { colorLabelMap, type HeatColor } from './utils/colorUtils';
import { calculateSurferStats, getEffectiveJudgeCount } from './utils/scoring';
import { getHeatIdentifiers, ensureHeatId } from './utils/heat';

const STORAGE_KEYS = {
  config: 'surfJudgingConfig',
  configSaved: 'surfJudgingConfigSaved',
  timer: 'surfJudgingTimer',
  scores: 'surfJudgingScores',
  currentJudge: 'surfJudgingCurrentJudge',
  judgeWorkCount: 'surfJudgingJudgeWorkCount'
} as const;

const ACTIVE_EVENT_STORAGE_KEY = 'surfJudgingActiveEventId';

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

type HeatEntryParticipant = {
  name?: string | null;
  country?: string | null;
  license?: string | null;
};

type HeatEntryWithParticipant = {
  color?: string | null;
  participant?: HeatEntryParticipant | null;
  participant_id?: number | null;
  seed?: number | null;
};

const normalizeHeatEntries = (entries: unknown): HeatEntryWithParticipant[] => {
  if (Array.isArray(entries)) {
    return entries as HeatEntryWithParticipant[];
  }
  return [];
};

const INITIAL_CONFIG: AppConfig = {
  competition: '',
  division: '',
  round: 1,
  heatId: 1,
  judges: ['J1', 'J2', 'J3'],
  surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
  waves: 15,
  judgeNames: {},
  judgeEmails: {},
  surferNames: {},
  surferCountries: {},
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
    judgeNames: partial.judgeNames ?? {},
    judgeEmails: partial.judgeEmails ?? {},
    surferNames: partial.surferNames ?? {},
    surferCountries: partial.surferCountries ?? {}
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
    if (!Array.isArray(parsed)) return [];
    return parsed.map((score) => ({
      ...score,
      heat_id: ensureHeatId(score.heat_id),
    }));
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
  const [availableDivisions, setAvailableDivisions] = useState<string[]>([]);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [configLoadState, setConfigLoadState] = useState<'loading' | 'loaded' | 'empty' | 'error'>('loading');
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [configLoadedFromDb, setConfigLoadedFromDb] = useState(false);
  
  // Timer state
  const [timer, setTimer] = useState<HeatTimer>({ ...DEFAULT_TIMER_STATE });
  const [heatStatus, setHeatStatus] = useState<'waiting' | 'running' | 'paused' | 'finished'>('waiting');

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

  const persistScoresState = useCallback((nextScores: Score[]) => {
    try {
      localStorage.setItem(STORAGE_KEYS.scores, JSON.stringify(nextScores));
    } catch (error) {
      console.warn('⚠️ Impossible de persister les scores:', error);
    }
  }, []);

  const mergeIncomingScore = useCallback((incoming: Score, targetHeatId: string) => {
    const normalizedHeatId = ensureHeatId(targetHeatId);
    const incomingHeatId = ensureHeatId(incoming.heat_id);
    if (normalizedHeatId !== incomingHeatId) {
      return null;
    }

    const normalisedScore = { ...incoming, heat_id: incomingHeatId };
    setScores(prev => {
      const filtered = prev.filter(score => !(
        ensureHeatId(score.heat_id) === incomingHeatId &&
        score.judge_id === normalisedScore.judge_id &&
        score.wave_number === normalisedScore.wave_number
      ));
      const updated = [...filtered, normalisedScore].sort(
        (a, b) => new Date(a.created_at || a.timestamp).getTime() - new Date(b.created_at || b.timestamp).getTime()
      );
      persistScoresState(updated);
      return updated;
    });
    return normalisedScore;
  }, [persistScoresState]);

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
    loadOverrideLogs,
    loadScoresFromDatabase
  } = useSupabaseSync();

  const {
    isConnected: realtimeConnected,
    lastUpdate: realtimeLastUpdate,
    error: realtimeError,
    publishTimerStart,
    publishTimerPause,
    publishTimerReset,
    markHeatFinished,
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
    const eventParam = urlParams.get('event');
    const divisionParam = urlParams.get('division');
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
    } else {
      if (eventParam || divisionParam) {
        setConfig((prev) => {
          const nextConfig = {
            ...prev,
            competition: eventParam ?? prev.competition,
            division: divisionParam ?? prev.division,
          };
          persistConfig(nextConfig);
          return nextConfig;
        });
        setConfigSaved(false);
        localStorage.setItem(STORAGE_KEYS.configSaved, 'false');
      }
    }

    if (judgeParam) {
      setCurrentView('judge');
      setViewLock('judge');
    }
    if (!judgeParam && viewParam === 'display') {
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

    const storedEventIdRaw = localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY);
    if (storedEventIdRaw) {
      const parsedEventId = Number(storedEventIdRaw);
      if (!Number.isNaN(parsedEventId) && parsedEventId > 0) {
        setActiveEventId(parsedEventId);
      }
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      const hasLocalConfig =
        typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEYS.configSaved) === 'true';
      setConfigLoadState(hasLocalConfig ? 'loaded' : 'empty');
      setConfigLoadError(null);
      setConfigLoadedFromDb(false);
      return;
    }

    let cancelled = false;

    const bootstrapFromSupabase = async () => {
      setConfigLoadState('loading');
      setConfigLoadError(null);
      setConfigLoadedFromDb(false);

      try {
        const latest = await fetchLatestEventConfig();
        if (cancelled) return;

        let distinctDivisions: string[] = [];
        try {
          distinctDivisions = await fetchDistinctDivisions(latest?.id ?? undefined);
        } catch (divisionError) {
          if (!cancelled) {
            console.warn('Impossible de récupérer les divisions distinctes', divisionError);
          }
        }

        const eventCategories = Array.isArray(latest?.categories)
          ? (latest.categories as unknown[]).map((value) => (typeof value === 'string' ? value : null)).filter((value): value is string => Boolean(value))
          : [];

        const mergedDivisions = Array.from(
          new Set<string>([...distinctDivisions, ...eventCategories].filter((value): value is string => Boolean(value)))
        );

        if (!cancelled) {
          setAvailableDivisions(mergedDivisions);
        }

        if (!latest) {
          if (!cancelled) {
            const blankConfig = { ...INITIAL_CONFIG };
            setConfig(blankConfig);
            persistConfig(blankConfig);
            setConfigLoadState('empty');
            setConfigLoadError(null);
            setConfigLoadedFromDb(false);
            setConfigSaved(false);
            localStorage.setItem(STORAGE_KEYS.configSaved, 'false');
          }
          return;
        }

        if (!cancelled) {
          setActiveEventId(latest.id);
          localStorage.setItem(ACTIVE_EVENT_STORAGE_KEY, String(latest.id));
        }

        const snapshot = latest ? await fetchEventConfigSnapshot(latest.id) : null;
        if (cancelled) return;

        const judgeNamesFromEvent: Record<string, string> = {};
        const snapshotJudges = snapshot?.judges ?? [];
        snapshotJudges.forEach((judge) => {
          judgeNamesFromEvent[judge.id] = judge.name ?? judge.id;
        });
        latest.judges.forEach((judge) => {
          if (!judgeNamesFromEvent[judge.id]) {
            judgeNamesFromEvent[judge.id] = judge.name ?? judge.id;
          }
        });

        const preferredDivision = snapshot?.division
          ?? (latest.config?.division && typeof latest.config.division === 'string' ? latest.config.division : null)
          ?? mergedDivisions[0]
          ?? '';

        const competitionName =
          (snapshot?.event_name && snapshot.event_name.trim()) ||
          (typeof latest.config?.competition === 'string' && latest.config.competition.trim()) ||
          (latest.name && latest.name.trim()) ||
          '';

        const nextConfig = normaliseConfig({
          competition: competitionName,
          division: preferredDivision,
          round: snapshot?.round ?? latest.config?.round ?? 1,
          heatId: snapshot?.heat_number ?? latest.config?.heatId ?? 1,
          waves: latest.config?.waves ?? DEFAULT_TIMER_DURATION,
          judges:
            latest.config?.judges && Array.isArray(latest.config.judges) && latest.config.judges.length > 0
              ? (latest.config.judges as string[])
              : snapshotJudges.length
                ? snapshotJudges.map((judge) => judge.id)
                : latest.judges.length
                  ? latest.judges.map((judge) => judge.id)
                  : INITIAL_CONFIG.judges,
          judgeNames: Object.keys(judgeNamesFromEvent).length ? judgeNamesFromEvent : INITIAL_CONFIG.judgeNames,
          surfers:
            latest.config?.surfers && Array.isArray(latest.config.surfers) && latest.config.surfers.length > 0
              ? (latest.config.surfers as string[])
              : INITIAL_CONFIG.surfers,
          tournamentType: latest.config?.tournamentType ?? 'elimination',
          totalSurfers: latest.config?.totalSurfers ?? INITIAL_CONFIG.totalSurfers,
          surfersPerHeat: latest.config?.surfersPerHeat ?? INITIAL_CONFIG.surfersPerHeat,
          totalHeats: latest.config?.totalHeats ?? INITIAL_CONFIG.totalHeats,
          totalRounds: latest.config?.totalRounds ?? INITIAL_CONFIG.totalRounds,
        });

        if (cancelled) return;

        setConfig(nextConfig);
        setConfigSaved(true);
        setConfigLoadedFromDb(true);
        setConfigLoadState('loaded');
        setConfigLoadError(null);
        persistConfig(nextConfig);
        localStorage.setItem(STORAGE_KEYS.configSaved, 'true');
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Erreur inattendue lors du chargement de la configuration.';
        setConfigLoadState('error');
        setConfigLoadError(message);
        setConfigLoadedFromDb(false);
        console.warn('Impossible de charger la configuration Supabase', error);
      }
    };

    void bootstrapFromSupabase();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!availableDivisions.length) return;
    if (config.division && availableDivisions.includes(config.division)) return;

    const nextDivision = availableDivisions[0];
    if (!nextDivision) return;

    setConfig((prev) => ({
      ...prev,
      division: nextDivision,
    }));
    setConfigSaved(false);
    localStorage.setItem(STORAGE_KEYS.configSaved, 'false');
  }, [availableDivisions, config.division]);

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

    console.log('🔔 Subscription temps réel pour heat:', currentHeatId);

    const unsubscribe = subscribeToHeat(currentHeatId, (newTimer, newConfig, status) => {
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

      if (status) {
        setHeatStatus(status);
      }
    });

    return unsubscribe;
  }, [configSaved, config.competition, currentHeatId, subscribeToHeat]);

  useEffect(() => {
    if (!configSaved || !config.competition) return;

    let cancelled = false;
    loadScoresFromDatabase(currentHeatId).then((remoteScores) => {
      if (cancelled || remoteScores.length === 0) return;
      setScores(remoteScores);
      persistScoresState(remoteScores);
    }).catch((error) => {
      console.warn('⚠️ Impossible de charger les scores distants:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [configSaved, config.competition, currentHeatId, loadScoresFromDatabase, persistScoresState]);

  useEffect(() => {
    const handleRealtimeScore = (event: Event) => {
      const customEvent = event as CustomEvent<Score>;
      if (!customEvent.detail) return;
      mergeIncomingScore(customEvent.detail, currentHeatId);
    };

    window.addEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
    return () => window.removeEventListener('newScoreRealtime', handleRealtimeScore as EventListener);
  }, [currentHeatId, mergeIncomingScore]);

  // Charger les logs d'override pour le heat courant
  useEffect(() => {
    if (!configSaved || !config.competition) {
      setOverrideLogs([]);
      return;
    }

    let cancelled = false;

    const loadLogs = async () => {
      const logs = await loadOverrideLogs(currentHeatId);
      if (!cancelled) {
        setOverrideLogs(logs);
      }
    };

    loadLogs();

    return () => {
      cancelled = true;
    };
  }, [configSaved, config.competition, currentHeatId, loadOverrideLogs]);

  useEffect(() => {
    if (!configSaved || !config.competition || !isSupabaseConfigured()) return;

    let cancelled = false;
    const syncHeatSurfers = async () => {
      const collectedNames: Record<string, string> = {};
      const collectedCountries: Record<string, string> = {};

      try {
        let mappedSurfers: string[] = [];

        try {
          const entriesRaw = await fetchHeatEntriesWithParticipants(currentHeatId);
          const entries = normalizeHeatEntries(entriesRaw);
          if (!cancelled && entries.length) {
            const colors = entries
              .map((entry) => entry.color?.toString().toUpperCase() ?? '')
              .filter((value): value is string => Boolean(value));

            const uniqueColors: string[] = [];
            colors.forEach((color) => {
              if (!uniqueColors.includes(color)) uniqueColors.push(color);
            });

            entries.forEach((entry) => {
              const normalizedColor = entry.color?.toString().toUpperCase() as HeatColor | undefined;
              if (!normalizedColor) return;
              const label = colorLabelMap[normalizedColor] ?? normalizedColor;
              if (entry.participant?.name) {
                collectedNames[label] = entry.participant.name;
              }
              if (entry.participant?.country) {
                collectedCountries[label] = entry.participant.country;
              }
            });

            mappedSurfers = uniqueColors.map((color) => {
              const castColor = color as HeatColor;
              return colorLabelMap[castColor] ?? color;
            });
          }
        } catch (entryError) {
          console.warn('Impossible de récupérer les participants du heat', entryError);
        }

        const currentNormalized = config.surfers.map((color) => color.toUpperCase());

        if (!mappedSurfers.length) {
          const defaultNormalized = INITIAL_CONFIG.surfers.map((color) => color.toUpperCase());
          const isDefaultConfig = arraysEqual(currentNormalized, defaultNormalized);
          if (!isDefaultConfig) {
            return;
          }
          const metadata = await fetchHeatMetadata(currentHeatId);
          if (!metadata) return;

          const colors = Array.isArray(metadata.color_order) ? metadata.color_order : [];
          const normalizedColors = colors
            .map((color) => (typeof color === 'string' ? color.toUpperCase() : ''))
            .filter((value): value is string => Boolean(value));

          if (normalizedColors.length) {
            const trimmedColors = metadata.heat_size
              ? normalizedColors.slice(0, metadata.heat_size)
              : normalizedColors;

            mappedSurfers = trimmedColors.map((color) => {
              const castColor = color as HeatColor;
              return colorLabelMap[castColor] ?? color;
            });
          }
        }

        if (!mappedSurfers.length || cancelled) {
          return;
        }

        const candidateNormalized = mappedSurfers.map((color) => color.toUpperCase());
        const shouldUpdateSurfers =
          !arraysEqual(currentNormalized, candidateNormalized) ||
          config.surfersPerHeat !== mappedSurfers.length;
        const hasNameData = Object.keys(collectedNames).length > 0;
        const hasCountryData = Object.keys(collectedCountries).length > 0;

        if (!shouldUpdateSurfers && !hasNameData && !hasCountryData) {
          return;
        }

        setConfig((prev) => {
          let changed = false;
          const updated: AppConfig = { ...prev };

          if (shouldUpdateSurfers) {
            updated.surfers = mappedSurfers;
            updated.surfersPerHeat = mappedSurfers.length || prev.surfersPerHeat;
            changed = true;
          }

          if (hasNameData) {
            const prevNames = prev.surferNames ?? {};
            const mergedNames = { ...prevNames, ...collectedNames };
            if (!objectsShallowEqual(prevNames, mergedNames)) {
              updated.surferNames = mergedNames;
              changed = true;
            }
          }

          if (hasCountryData) {
            const prevCountries = prev.surferCountries ?? {};
            const mergedCountries = { ...prevCountries, ...collectedCountries };
            if (!objectsShallowEqual(prevCountries, mergedCountries)) {
              updated.surferCountries = mergedCountries;
              changed = true;
            }
          }

          if (!changed) {
            return prev;
          }

          persistConfig(updated);
          return updated;
        });
      } catch (error) {
        console.warn('Impossible de synchroniser les couleurs du heat', error);
      }
    };

    syncHeatSurfers();

    return () => {
      cancelled = true;
    };
  }, [configSaved, config.competition, currentHeatId, config.surfers, config.surfersPerHeat]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const rawCache = window.localStorage.getItem(HEAT_COLOR_CACHE_KEY);
      if (!rawCache) return;
      const parsed = JSON.parse(rawCache) as Record<string, Record<string, { name?: string; country?: string }>>;
      const entry = parsed[currentHeatId];
      if (!entry) return;

      const names: Record<string, string> = {};
      const countries: Record<string, string> = {};

      Object.entries(entry).forEach(([key, value]) => {
        if (!value) return;
        const normalized = key.toUpperCase();
        const isHeatColor = Object.prototype.hasOwnProperty.call(colorLabelMap, normalized);
        const label = isHeatColor ? colorLabelMap[normalized as HeatColor] : normalized;
        if (value.name) {
          names[label] = value.name;
        }
        if (value.country) {
          countries[label] = value.country;
        }
      });

      if (!Object.keys(names).length && !Object.keys(countries).length) {
        return;
      }

      setConfig((prev) => {
        const mergedNames = { ...(prev.surferNames ?? {}), ...names };
        const mergedCountries = { ...(prev.surferCountries ?? {}), ...countries };
        const namesChanged = !objectsShallowEqual(prev.surferNames ?? {}, mergedNames);
        const countriesChanged = !objectsShallowEqual(prev.surferCountries ?? {}, mergedCountries);
        if (!namesChanged && !countriesChanged) {
          return prev;
        }
        const nextConfig = {
          ...prev,
          surferNames: mergedNames,
          surferCountries: mergedCountries,
        };
        persistConfig(nextConfig);
        return nextConfig;
      });
    } catch (error) {
      console.warn('Impossible de lire le cache de noms de surfeurs', error);
    }
  }, [currentHeatId]);

  // Polling de secours pour récupérer config/timer depuis Supabase (fiabilité mobile)
  useEffect(() => {
    if (!configSaved || !config.competition || !syncStatus.supabaseEnabled) return;

    let cancelled = false;

    const syncFromRealtime = async () => {
      const realtimeState = await fetchRealtimeState(currentHeatId);
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

      if (realtimeState.status && heatStatus !== realtimeState.status) {
        setHeatStatus(realtimeState.status);
      }

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
  }, [configSaved, config.competition, currentHeatId, syncStatus.supabaseEnabled, fetchRealtimeState, config, timer, heatStatus]);

  // Gestionnaires d'événements
  const handleConfigChange = (newConfig: AppConfig) => {
    setConfig(newConfig);
    if (configSaved) {
      setConfigSaved(false);
      localStorage.setItem(STORAGE_KEYS.configSaved, 'false');
    }
    persistConfig(newConfig);
    setConfigLoadedFromDb(false);
  };

  const handleConfigSaved = async (saved: boolean) => {
    setConfigSaved(saved);
    localStorage.setItem(STORAGE_KEYS.configSaved, saved.toString());

    if (saved) {
      const divisionsPayload = Array.from(
        new Set<string>(
          [...availableDivisions, config.division]
            .filter((value): value is string => Boolean(value))
        )
      );
      const judgesPayload = config.judges.map((id) => ({
        id,
        name: config.judgeNames[id] || id,
      }));

      const storedEventIdRaw = localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY);
      const eventIdFromStorage = storedEventIdRaw ? Number(storedEventIdRaw) : NaN;
      const effectiveEventId = activeEventId ?? (!Number.isNaN(eventIdFromStorage) ? eventIdFromStorage : null);

      if (navigator.onLine && isSupabaseConfigured() && effectiveEventId) {
        try {
          await updateEventConfiguration(effectiveEventId, {
            config,
            divisions: divisionsPayload,
            judges: judgesPayload,
          });
          await saveEventConfigSnapshot({
            eventId: effectiveEventId,
            eventName: config.competition,
            division: config.division,
            round: config.round,
            heatNumber: config.heatId,
            judges: judgesPayload,
          });
          setConfigLoadedFromDb(true);
          setConfigLoadState('loaded');
          setConfigLoadError(null);
        } catch (error) {
          console.warn('Impossible de synchroniser la configuration événement avec Supabase', error);
          setConfigLoadedFromDb(false);
          setConfigLoadError(error instanceof Error ? error.message : 'Synchronisation de la configuration impossible.');
        }
      } else {
        setConfigLoadedFromDb(false);
        setConfigLoadState('loaded');
        if (!navigator.onLine) {
          setConfigLoadError('Configuration enregistrée localement (mode hors ligne).');
        } else {
          setConfigLoadError(null);
        }
      }

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
        await saveHeatConfig(currentHeatId, config);

        // Publier la config en temps réel
        await publishConfigUpdate(currentHeatId, config);

        console.log('✅ Heat créé et config publiée:', currentHeatId);
      } catch (error) {
        console.log('⚠️ Heat créé en mode local uniquement', error instanceof Error ? error.message : error);
      }

      persistConfig(config);
    }
  };

  const handleScoreSubmit = async (
    scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>
  ): Promise<Score | undefined> => {
    try {
      const newScore = await saveScore(scoreData, currentHeatId);
      
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

    try {
      const { updatedScore, log } = await overrideScore({
        heatId: currentHeatId,
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
            ensureHeatId(score.heat_id) === currentHeatId &&
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
    setConfig((prev) => {
      const next = {
        ...prev,
        judgeNames: {
          ...prev.judgeNames,
          [judgeId]: judgeName
        }
      };
      persistConfig(next);
      return next;
    });
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
    const closedAt = new Date().toISOString();

    try {
      await publishTimerPause(currentHeatId);
    } catch (error) {
      console.warn('Impossible de mettre le timer en pause', error instanceof Error ? error.message : error);
    }

    try {
      await updateHeatStatus(currentHeatId, 'closed', closedAt);
      console.log('✅ Heat fermé:', currentHeatId);
    } catch (error) {
      console.log('⚠️ Heat fermé en mode local uniquement', error instanceof Error ? error.message : error);
    }

    try {
      await markHeatFinished(currentHeatId);
    } catch (error) {
      console.warn('Impossible de marquer le heat comme terminé dans la table temps réel', error instanceof Error ? error.message : error);
    }

    setHeatStatus('finished');

    const newWorkCount = { ...judgeWorkCount };
    config.judges.forEach(judgeId => {
      newWorkCount[judgeId] = (newWorkCount[judgeId] || 0) + 1;
    });
    setJudgeWorkCount(newWorkCount);
    localStorage.setItem(STORAGE_KEYS.judgeWorkCount, JSON.stringify(newWorkCount));

    let colorCacheChanged = false;
    let colorCache: Record<string, Record<string, { name?: string; country?: string }>> = {};
    if (typeof window !== 'undefined') {
      const rawColorCache = window.localStorage.getItem(HEAT_COLOR_CACHE_KEY);
      if (rawColorCache) {
        try {
          colorCache = JSON.parse(rawColorCache) as typeof colorCache;
        } catch (error) {
          console.warn('Impossible de lire le cache de couleurs', error);
        }
      }
    }

    let eventId: number | null = null;
    if (typeof window !== 'undefined') {
      const eventIdRaw = window.localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY);
      const parsedEventId = eventIdRaw ? Number(eventIdRaw) : NaN;
      if (!Number.isNaN(parsedEventId) && parsedEventId) {
        eventId = parsedEventId;
      }
    }

    let sequence: Awaited<ReturnType<typeof fetchOrderedHeatSequence>> = [];

    if (eventId && isSupabaseConfigured()) {
      try {
        sequence = await fetchOrderedHeatSequence(eventId, config.division);
      } catch (error) {
        console.warn('Impossible de récupérer la séquence des heats', error instanceof Error ? error.message : error);
      }

      try {
        const currentEntriesRaw = await fetchHeatEntriesWithParticipants(currentHeatId);
        const currentEntries = normalizeHeatEntries(currentEntriesRaw);
        if (currentEntries.length) {
          const entryByColor = new Map<string, {
            participantId: number | null;
            seed: number | null;
            colorCode: string | null;
            name?: string;
            country?: string;
          }>();

          currentEntries.forEach((entry) => {
            const rawColor = entry.color ? entry.color.toUpperCase() : '';
            const label = rawColor ? colorLabelMap[(rawColor as HeatColor)] ?? rawColor : '';
            if (!label) return;
            entryByColor.set(label.toUpperCase(), {
              participantId: entry.participant_id ?? null,
              seed: entry.seed ?? null,
              colorCode: rawColor,
              name: entry.participant?.name ?? undefined,
              country: entry.participant?.country ?? undefined,
            });
          });

          const judgeCount = getEffectiveJudgeCount(scores, config.judges.length);
          const stats = calculateSurferStats(scores, config.surfers, judgeCount, config.waves)
            .sort((a, b) => a.rank - b.rank);

          const entryByRank = new Map<number, {
            participantId: number | null;
            seed: number | null;
            colorCode: string | null;
            colorLabel: string;
            name?: string;
            country?: string;
          }>();

          stats.forEach((stat) => {
            const colorKey = stat.surfer.trim().toUpperCase();
            const info = entryByColor.get(colorKey);
            if (info) {
              entryByRank.set(stat.rank, {
                participantId: info.participantId,
                seed: info.seed ?? null,
                colorCode: info.colorCode ?? null,
                colorLabel: colorKey,
                name: info.name ?? stat.surfer,
                country: info.country ?? undefined,
              });
            }
          });

          for (const heatMeta of sequence) {
            const mappings = await fetchHeatSlotMappings(heatMeta.id);
            if (!mappings.length) continue;

            const targetColorOrder = (heatMeta.color_order ?? []).map((color) => color?.toUpperCase?.() ?? '');
            const updates: { position: number; participant_id: number | null; seed?: number | null; color?: string | null }[] = [];
            const cacheEntries: Record<string, { name?: string; country?: string }> = {};

            mappings.forEach((mapping) => {
              if (mapping.source_round !== config.round || mapping.source_heat !== config.heatId) return;
              const rank = mapping.source_position ?? null;
              if (!rank) return;
              const qualifier = entryByRank.get(rank);
              if (!qualifier) return;

              const targetColorCode = targetColorOrder[mapping.position - 1] || qualifier.colorCode || null;
              updates.push({
                position: mapping.position,
                participant_id: qualifier.participantId,
                seed: qualifier.seed ?? null,
                color: targetColorCode,
              });

              if (targetColorCode) {
                cacheEntries[targetColorCode.toUpperCase()] = {
                  name: qualifier.name,
                  country: qualifier.country ?? undefined,
                };
              }
            });

            if (updates.length) {
              try {
                await replaceHeatEntries(heatMeta.id, updates);
                colorCache[heatMeta.id] = {
                  ...(colorCache[heatMeta.id] ?? {}),
                  ...cacheEntries,
                };
                colorCacheChanged = true;
              } catch (error) {
                console.warn(`Impossible de mettre à jour les participants du heat ${heatMeta.id}`, error instanceof Error ? error.message : error);
              }
            }
          }
        }
      } catch (error) {
        console.warn('Impossible de préparer les qualifiés pour le heat suivant', error instanceof Error ? error.message : error);
      }
    }

    let nextRound = config.round;
    let nextHeatNumber = config.heatId;
    let nextCandidate: Awaited<ReturnType<typeof fetchOrderedHeatSequence>>[number] | null = null;

    if (sequence.length) {
      const currentIndex = sequence.findIndex((item) => ensureHeatId(item.id) === currentHeatId);
      if (currentIndex >= 0) {
        nextCandidate = sequence.slice(currentIndex + 1).find((item) => item.status !== 'closed') ?? null;
        if (nextCandidate) {
          nextRound = nextCandidate.round;
          nextHeatNumber = nextCandidate.heat_number;
        }
      }
    }

    const advanced = nextRound !== config.round || nextHeatNumber !== config.heatId;

    let nextSurfers = config.surfers;
    let nextSurfersPerHeat = config.surfersPerHeat;

    if (nextCandidate && Array.isArray(nextCandidate.color_order) && nextCandidate.color_order.length) {
      const normalizedColors = nextCandidate.color_order
        .map((color) => color?.toString()?.toUpperCase() ?? '')
        .filter((value): value is string => Boolean(value));

      const mappedSurfers = normalizedColors.map((color) => {
        const heatColor = color as HeatColor;
        return colorLabelMap[heatColor] ?? color;
      });

      if (mappedSurfers.length) {
        nextSurfers = mappedSurfers;
        nextSurfersPerHeat = nextCandidate.heat_size ?? mappedSurfers.length;
      }
    }

    const nextHeatKeyCandidate = nextCandidate ? ensureHeatId(nextCandidate.id) : null;

    if (nextHeatKeyCandidate && eventId && isSupabaseConfigured()) {
      try {
        const nextHeatEntriesRaw = await fetchHeatEntriesWithParticipants(nextHeatKeyCandidate);
        const nextHeatEntries = normalizeHeatEntries(nextHeatEntriesRaw);
        if (nextHeatEntries.length) {
          const cacheEntries: Record<string, { name?: string; country?: string }> = {};
          nextHeatEntries.forEach((entry) => {
            const rawColor = entry.color ? entry.color.toUpperCase() : '';
            const label = rawColor ? colorLabelMap[(rawColor as HeatColor)] ?? rawColor : '';
            if (!label) return;
            cacheEntries[rawColor] = {
              name: entry.participant?.name ?? undefined,
              country: entry.participant?.country ?? undefined,
            };
            cacheEntries[label.toUpperCase()] = {
              name: entry.participant?.name ?? undefined,
              country: entry.participant?.country ?? undefined,
            };
          });

          if (Object.keys(cacheEntries).length) {
            colorCache[nextHeatKeyCandidate] = {
              ...(colorCache[nextHeatKeyCandidate] ?? {}),
              ...cacheEntries,
            };
            colorCacheChanged = true;
          }
        }
      } catch (error) {
        console.warn('Impossible de précharger les participants du heat suivant', error instanceof Error ? error.message : error);
      }
    }

    if (colorCacheChanged && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(HEAT_COLOR_CACHE_KEY, JSON.stringify(colorCache));
      } catch (error) {
        console.warn('Impossible de sauvegarder le cache de couleurs', error);
      }
    }

    const newConfig = advanced
      ? {
          ...config,
          round: nextRound,
          heatId: nextHeatNumber,
          surfers: nextSurfers,
          surfersPerHeat: nextSurfersPerHeat,
        }
      : { ...config };
    setConfig(newConfig);
    persistConfig(newConfig);
    setHeatStatus(advanced ? 'waiting' : 'finished');

    const resetTimer = {
      isRunning: false,
      startTime: null,
      duration: DEFAULT_TIMER_DURATION
    };
    setTimer(resetTimer);
    persistTimer(resetTimer);

    setScores([]);
    localStorage.setItem(STORAGE_KEYS.scores, JSON.stringify([]));

    const nextHeatIdentifiers = getHeatIdentifiers(
      newConfig.competition,
      newConfig.division,
      newConfig.round,
      newConfig.heatId
    );
    const nextHeatKey = nextHeatIdentifiers.normalized;

    try {
      // Inform current heat subscribers that we're moving on
      await publishConfigUpdate(currentHeatId, newConfig);
      await publishTimerReset(currentHeatId, resetTimer.duration);

      const shouldCreateRemoteHeat =
        !isSupabaseConfigured() || !eventId || !nextCandidate;

      if (shouldCreateRemoteHeat) {
        await createHeat({
          competition: newConfig.competition,
          division: newConfig.division,
          round: newConfig.round,
          heat_number: newConfig.heatId,
          status: 'open',
          surfers: newConfig.surfers.map((surfer) => ({
            color: surfer,
            name: surfer,
            country: 'SENEGAL',
          })),
        });
      }

      await saveHeatConfig(nextHeatKey, newConfig);
      await saveTimerState(nextHeatKey, resetTimer);
      await publishConfigUpdate(nextHeatKey, newConfig);
      await publishTimerReset(nextHeatKey, resetTimer.duration);
    } catch (error) {
      console.log('⚠️ Synchronisation du nouveau heat différée:', error instanceof Error ? error.message : error);
    }

    if (advanced) {
      console.log(`🏁 Heat ${config.heatId} fermé, passage au heat R${newConfig.round}H${newConfig.heatId}`);
    } else {
      console.log('🏁 Heat fermé. Aucun autre heat planifié.');
    }
  };

  const buildSharedUrl = (view: 'admin' | 'judge' | 'display', judgeId?: string | null) => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const timerSnapshot = buildTimerSnapshot(timer);
    const payload = {
      ...config,
      configSaved,
      heatUniqueId: currentHeatId,
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
            availableDivisions={availableDivisions}
            loadState={configLoadState}
            loadError={configLoadError}
            loadedFromDb={configLoadedFromDb}
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
            heatStatus={heatStatus}
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
