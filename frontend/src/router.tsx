import { createBrowserRouter, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useCallback, FormEvent } from 'react';
import LandingPage from './components/LandingPage';
import CreateEvent from './components/CreateEvent';
import PaymentPage from './components/PaymentPage';
import ParticipantsPage from './components/ParticipantsPage';
import GenerateHeatsPage from './components/GenerateHeatsPage';
import JudgeInterface from './components/JudgeInterface';
import AdminInterface from './components/AdminInterface';
import ScoreDisplay from './components/ScoreDisplay';
import MyEventsPage from './pages/MyEvents';
import { useSupabaseSync } from './hooks/useSupabaseSync';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { JudgeLogin } from './components/JudgeLogin';
import type { AppConfig, HeatTimer, Score } from './types';

// Minimal default config used when nothing is in localStorage
const DEFAULT_CONFIG: AppConfig = {
  competition: '',
  division: 'OPEN',
  round: 1,
  heatId: 1,
  judges: ['J1', 'J2', 'J3'],
  surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
  waves: 15,
  judgeNames: {},
  surferNames: {},
  surferCountries: {},
  tournamentType: 'elimination',
  totalSurfers: 0,
  surfersPerHeat: 2,
  totalHeats: 0,
  totalRounds: 1
};

function parseStoredConfig(): AppConfig {
  try {
    const raw = localStorage.getItem('surfJudgingConfig');
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CONFIG;
    return normaliseConfigData(parsed as Partial<AppConfig>);
  } catch (e) {
    return DEFAULT_CONFIG;
  }
}

const DEFAULT_TIMER: HeatTimer = { isRunning: false, startTime: null, duration: 20 };

function normaliseConfigData(data: Partial<AppConfig>): AppConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...data,
    judges: data.judges && data.judges.length ? data.judges : DEFAULT_CONFIG.judges,
    surfers: data.surfers && data.surfers.length ? data.surfers : DEFAULT_CONFIG.surfers,
    judgeNames: { ...DEFAULT_CONFIG.judgeNames, ...(data.judgeNames || {}) }
  };

  return {
    ...merged,
    tournamentType: merged.tournamentType === 'repechage' ? 'repechage' : 'elimination',
    totalSurfers: data.totalSurfers ?? merged.totalSurfers ?? merged.surfers.length,
    surfersPerHeat: data.surfersPerHeat ?? merged.surfersPerHeat ?? merged.surfers.length,
    totalHeats: data.totalHeats ?? merged.totalHeats,
    totalRounds: data.totalRounds ?? merged.totalRounds
  };
}

function normaliseTimerSnapshot(snapshot: any): HeatTimer {
  if (!snapshot) return DEFAULT_TIMER;
  const durationCandidate = Number(snapshot.duration ?? snapshot.duration_minutes ?? DEFAULT_TIMER.duration);
  const duration = Number.isFinite(durationCandidate) && durationCandidate > 0 ? durationCandidate : DEFAULT_TIMER.duration;
  const start = snapshot.startTime ?? snapshot.start_time ?? null;
  return {
    isRunning: Boolean(snapshot.isRunning ?? snapshot.is_running ?? false),
    startTime: start ? new Date(start) : null,
    duration
  };
}

import { fetchEventConfigSnapshot, saveEventConfigSnapshot, EventConfigSnapshot } from './api/supabaseClient';

function ChiefJudgeWrapper() {
  const [config, setConfig] = useState<AppConfig>(() => parseStoredConfig());
  const [configSaved, setConfigSaved] = useState(() => localStorage.getItem('surfJudgingConfigSaved') === 'true');
  const [timer, setTimer] = useState<HeatTimer>({ isRunning: false, startTime: null, duration: 20 });
  const [scores, setScores] = useState<any[]>([]);
  const [judgeWorkCount, setJudgeWorkCount] = useState<Record<string, number>>({});
  const [overrideLogs, setOverrideLogs] = useState<any[]>([]);
  const [loadedFromDb, setLoadedFromDb] = useState(false);

  const {
    createHeat,
    updateHeatStatus,
    saveHeatConfig,
    saveTimerState,
    overrideScore,
    loadOverrideLogs
  } = useSupabaseSync();

  const {
    publishTimerStart,
    publishTimerPause,
    publishTimerReset,
    publishConfigUpdate,
    subscribeToHeat
  } = useRealtimeSync();

  // Load persisted state on mount and try to fetch from DB
  useEffect(() => {
    const stored = parseStoredConfig();
    setConfig(stored as AppConfig);
    setConfigSaved(localStorage.getItem('surfJudgingConfigSaved') === 'true');

    // Try to load from DB if we have an active event ID
    const activeEventId = localStorage.getItem('surfJudgingActiveEventId');
    if (activeEventId) {
      fetchEventConfigSnapshot(Number(activeEventId))
        .then((snapshot: EventConfigSnapshot | null) => {
          if (snapshot) {
            console.log('✅ Config loaded from DB for event:', activeEventId);
            const dbConfig: AppConfig = {
              ...stored,
              competition: snapshot.event_name || stored.competition,
              division: snapshot.division || stored.division,
              round: snapshot.round || stored.round,
              heatId: snapshot.heat_number || stored.heatId,
              judges: snapshot.judges?.map((j: any) => j.id) || stored.judges,
              judgeNames: snapshot.judges?.reduce((acc: any, j: any) => ({ ...acc, [j.id]: j.name || j.id }), {}) || stored.judgeNames,
              surfers: snapshot.surfers || stored.surfers,
              surferNames: snapshot.surferNames || stored.surferNames,
              surferCountries: snapshot.surferCountries || stored.surferCountries,
              surfersPerHeat: snapshot.surfers?.length || stored.surfersPerHeat
            };
            setConfig(dbConfig);
            setLoadedFromDb(true);
            // Update localStorage to match DB
            localStorage.setItem('surfJudgingConfig', JSON.stringify(dbConfig));
          }
        })
        .catch((err: any) => console.warn('⚠️ Failed to load from DB:', err));
    }

    try {
      const rawTimer = localStorage.getItem('surfJudgingTimer');
      if (rawTimer) {
        const parsed = JSON.parse(rawTimer);
        setTimer(parsed as HeatTimer);
      }
    } catch (e) {
      // ignore
    }

    try {
      const rawScores = localStorage.getItem('surfJudgingScores');
      if (rawScores) setScores(JSON.parse(rawScores));
    } catch (e) { }

    try {
      const rawWork = localStorage.getItem('surfJudgingJudgeWorkCount');
      if (rawWork) setJudgeWorkCount(JSON.parse(rawWork));
    } catch (e) { }
  }, []);

  // Subscribe to realtime for the current heat when configSaved
  useEffect(() => {
    if (!configSaved || !config.competition) return;
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

    const unsubscribe = subscribeToHeat(heatId, (newTimer, newConfig) => {
      if (newTimer) {
        setTimer(newTimer);
        try { localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer)); } catch { }
      }
      if (newConfig) {
        setConfig(prev => ({ ...prev, ...newConfig } as AppConfig));
      }
    });

    return unsubscribe;
  }, [configSaved, config.competition, config.division, config.round, config.heatId, subscribeToHeat]);

  const handleConfigChange = (next: AppConfig) => {
    setConfig(next);
    try { localStorage.setItem('surfJudgingConfig', JSON.stringify(next)); } catch { }
    setConfigSaved(false);
  };

  const handleConfigSaved = async (saved: boolean) => {
    setConfigSaved(saved);
    try { localStorage.setItem('surfJudgingConfigSaved', saved ? 'true' : 'false'); } catch { }

    if (saved) {
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
      try {
        await createHeat({
          competition: config.competition,
          division: config.division,
          round: config.round,
          heat_number: config.heatId,
          status: 'open',
          surfers: config.surfers.map(s => ({ color: s, name: s, country: 'SENEGAL' }))
        });

        await saveHeatConfig(heatId, config);

        // Save snapshot to event_last_config for persistence and public display
        const activeEventId = localStorage.getItem('surfJudgingActiveEventId');
        if (activeEventId) {
          const judgesPayload = config.judges.map(id => ({
            id,
            name: config.judgeNames[id] || id
          }));

          await saveEventConfigSnapshot({
            eventId: Number(activeEventId),
            eventName: config.competition,
            division: config.division,
            round: config.round,
            heatNumber: config.heatId,
            judges: judgesPayload
          });
          console.log('✅ Snapshot saved to DB for event:', activeEventId);
        }

        if (publishConfigUpdate) {
          await publishConfigUpdate(heatId, config);
        }
      } catch (error) {
        console.warn('⚠️ Heat créé en mode local uniquement', error);
      }
    }
  };

  const handleTimerChange = (t: HeatTimer) => {
    setTimer(t);
    try { localStorage.setItem('surfJudgingTimer', JSON.stringify(t)); } catch { }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const handleScoreOverride = async (input: any) => {
    try {
      const result = await overrideScore(input as any);
      // update local logs
      const logs = await loadOverrideLogs(`${input.heatId}`);
      setOverrideLogs(logs);
      return result?.log ?? undefined;
    } catch (e) {
      console.error('Erreur override:', e);
      return undefined;
    }
  };

  const handleCloseHeat = async () => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    try {
      await updateHeatStatus(heatId, 'closed', new Date().toISOString());
    } catch (e) {
      console.warn('⚠️ updateHeatStatus failed, proceeding locally');
    }

    const newWorkCount = { ...judgeWorkCount };
    config.judges.forEach(judgeId => {
      newWorkCount[judgeId] = (newWorkCount[judgeId] || 0) + 1;
    });
    setJudgeWorkCount(newWorkCount);
    try { localStorage.setItem('surfJudgingJudgeWorkCount', JSON.stringify(newWorkCount)); } catch { }

    const nextHeatId = config.heatId + 1;
    const newConfig = { ...config, heatId: nextHeatId } as AppConfig;
    setConfig(newConfig);
    try { localStorage.setItem('surfJudgingConfig', JSON.stringify(newConfig)); } catch { }
    setTimer({ isRunning: false, startTime: null, duration: timer.duration });
    try { localStorage.setItem('surfJudgingTimer', JSON.stringify({ isRunning: false, startTime: null, duration: timer.duration })); } catch { }

    setScores([]);
    try { localStorage.setItem('surfJudgingScores', JSON.stringify([])); } catch { }

    const nextHeatKey = `${newConfig.competition}_${newConfig.division}_R${newConfig.round}_H${newConfig.heatId}`;
    console.log('🔄 Preparing next heat:', { nextHeatKey, heatId: newConfig.heatId });

    try {
      if (publishConfigUpdate) {
        console.log('📡 Publishing config update for:', nextHeatKey);
        await publishConfigUpdate(nextHeatKey, newConfig);
      }

      console.log('🏁 Creating new heat record in DB...');
      await createHeat({
        competition: newConfig.competition,
        division: newConfig.division,
        round: newConfig.round,
        heat_number: newConfig.heatId,
        status: 'open',
        surfers: newConfig.surfers.map(s => ({ color: s, name: s, country: 'SENEGAL' }))
      });
      console.log('✅ Heat record created successfully');

      console.log('💾 Saving heat config...');
      await saveHeatConfig(nextHeatKey, newConfig);
      console.log('✅ Heat config saved');

      console.log('⏱️ Saving timer state...');
      await saveTimerState(nextHeatKey, { isRunning: false, startTime: null, duration: timer.duration });
      console.log('✅ Timer state saved');

      console.log('🎉 Next heat fully prepared:', nextHeatKey);
    } catch (e) {
      console.error('❌ CRITICAL ERROR preparing next heat:', e);
      console.error('Error details:', {
        error: e,
        message: e instanceof Error ? e.message : 'Unknown error',
        nextHeatKey,
        config: newConfig
      });
      alert(`ERREUR: Impossible de créer le prochain heat. Vérifiez les logs de la console.\nErreur: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  };

  return (
    <AdminInterface
      config={config}
      onConfigChange={handleConfigChange}
      onConfigSaved={handleConfigSaved}
      configSaved={configSaved}
      timer={timer}
      onTimerChange={handleTimerChange}
      onReloadData={() => window.location.reload()}
      onResetAllData={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload(); }}
      onCloseHeat={handleCloseHeat}
      judgeWorkCount={judgeWorkCount}
      scores={scores}
      overrideLogs={overrideLogs}
      onScoreOverride={handleScoreOverride}
      onRealtimeTimerStart={publishTimerStart}
      onRealtimeTimerPause={publishTimerPause}
      onRealtimeTimerReset={publishTimerReset}
      loadedFromDb={loadedFromDb}
    />
  );
}

function JudgeWrapper() {
  const [searchParams] = useSearchParams();
  const { saveScore, loadScoresFromDatabase } = useSupabaseSync();
  const [config, setConfig] = useState<AppConfig>(() => parseStoredConfig());
  const [configSaved, setConfigSaved] = useState(() => localStorage.getItem('surfJudgingConfigSaved') === 'true');
  const [timer, setTimer] = useState<HeatTimer>(() => {
    try {
      const raw = localStorage.getItem('surfJudgingTimer');
      if (raw) {
        const parsed = JSON.parse(raw);
        return normaliseTimerSnapshot(parsed);
      }
    } catch (e) {
      // ignore
    }
    return DEFAULT_TIMER;
  });
  const [judgeId, setJudgeId] = useState<string | null>(null);
  const [judgeName, setJudgeName] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [judgeAuthenticated, setJudgeAuthenticated] = useState(false);

  useEffect(() => {
    const judgeParam = searchParams.get('judge_id') || searchParams.get('judge');
    if (judgeParam) {
      setJudgeId(judgeParam);
    }

    const configParam = searchParams.get('config');
    if (!configParam) return;

    try {
      const decoded = JSON.parse(atob(configParam));
      const { timerSnapshot, configSaved: savedFlag, judgeNames, ...rest } = decoded;
      const nextConfig = normaliseConfigData({
        ...rest,
        judgeNames: judgeNames || {}
      });

      setConfig(nextConfig);
      try { localStorage.setItem('surfJudgingConfig', JSON.stringify(nextConfig)); } catch { }

      const saved = savedFlag !== undefined ? Boolean(savedFlag) : true;
      setConfigSaved(saved);
      localStorage.setItem('surfJudgingConfigSaved', saved ? 'true' : 'false');

      if (timerSnapshot) {
        const nextTimer = normaliseTimerSnapshot(timerSnapshot);
        setTimer(nextTimer);
        try {
          localStorage.setItem('surfJudgingTimer', JSON.stringify({
            ...nextTimer,
            startTime: nextTimer.startTime ? nextTimer.startTime.toISOString() : null
          }));
        } catch (e) {
          // ignore quota issues
        }
      }
    } catch (error) {
      console.error('❌ Impossible de décoder la configuration juge depuis l’URL:', error);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!config.competition || !config.division) return;
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    loadScoresFromDatabase(heatId).then(scores => {
      if (!scores || scores.length === 0) return;
      try {
        localStorage.setItem('surfJudgingScores', JSON.stringify(scores));
      } catch (error) {
        console.warn('⚠️ Impossible de persister les scores dans localStorage:', error);
      }
    });
  }, [config.competition, config.division, config.round, config.heatId, loadScoresFromDatabase]);

  useEffect(() => {
    if (!judgeId) {
      setJudgeName('');
      setSignedIn(false);
      return;
    }

    const sessionKey = `surfJudgingJudgeName_${judgeId}`;
    const stored = sessionStorage.getItem(sessionKey);
    if (stored) {
      setJudgeName(stored);
      setSignedIn(true);
    } else {
      const defaultName = config.judgeNames?.[judgeId] || '';
      setJudgeName(defaultName);
      // If we have a default name but not signed in via session, we still might need auth
      // But for legacy links, we might auto-sign in. 
      // For new flow, we wait for auth.
      setSignedIn(false);
    }
  }, [judgeId, config.judgeNames]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      if (event.key === 'surfJudgingTimer') {
        try {
          const nextTimer = normaliseTimerSnapshot(JSON.parse(event.newValue));
          setTimer(nextTimer);
        } catch (error) {
          console.warn('⚠️ Impossible de mettre à jour le timer (juge):', error);
        }
      } else if (event.key === 'surfJudgingConfig') {
        try {
          const nextConfig = normaliseConfigData(JSON.parse(event.newValue));
          setConfig(nextConfig);
        } catch (error) {
          console.warn('⚠️ Impossible de mettre à jour la config (juge):', error);
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleScoreSubmit = useCallback(async (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>) => {
    if (!config.competition || !config.division) return undefined;
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    try {
      const savedScore = await saveScore(scoreData, heatId);
      return savedScore;
    } catch (error) {
      console.error('❌ Erreur sauvegarde score (interface juge):', error);
      return undefined;
    }
  }, [config.competition, config.division, config.round, config.heatId, saveScore]);

  const handleSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!judgeId) return;
    const name = judgeName.trim();
    if (!name) return;

    const sessionKey = `surfJudgingJudgeName_${judgeId}`;
    sessionStorage.setItem(sessionKey, name);
    setSignedIn(true);
    setConfig(prev => {
      const next = {
        ...prev,
        judgeNames: {
          ...prev.judgeNames,
          [judgeId]: name
        }
      };
      try {
        localStorage.setItem('surfJudgingConfig', JSON.stringify(next));
      } catch (error) {
        console.warn('⚠️ Impossible de persister le nom du juge:', error);
      }
      return next;
    });
  };

  const handleJudgeAuthSuccess = (judge: { id: string; name: string }) => {
    setJudgeAuthenticated(true);
    setJudgeId(judge.id);
    setJudgeName(judge.name);
    setSignedIn(true);

    // Persist name in session
    const sessionKey = `surfJudgingJudgeName_${judge.id}`;
    sessionStorage.setItem(sessionKey, judge.name);
  };

  // Show JudgeLogin if judge_id parameter exists and not authenticated
  const showJudgeLogin = judgeId && searchParams.get('judge_id') && !judgeAuthenticated && !signedIn;

  if (showJudgeLogin && judgeId) {
    return <JudgeLogin judgeId={judgeId} onSuccess={handleJudgeAuthSuccess} />;
  }

  if (!signedIn && !judgeAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-slate-800/80 backdrop-blur rounded-2xl p-8 shadow-xl border border-slate-700">
          <h1 className="text-2xl font-bold mb-4 text-center">Bienvenue</h1>
          <p className="text-sm text-slate-300 mb-6 text-center">
            {judgeId
              ? `Vous vous connectez en tant que ${judgeName || judgeId}. Merci d'indiquer votre nom pour confirmer votre présence.`
              : "Merci d'indiquer votre nom pour rejoindre le panel de juges."}
          </p>
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Nom du juge
              </label>
              <input
                value={judgeName}
                onChange={(e) => setJudgeName(e.target.value)}
                placeholder="Ex: A. Diop"
                className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!judgeName.trim()}
              className="w-full py-3 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-400 transition-colors font-medium"
            >
              Rejoindre l'interface juge
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <JudgeInterface
      config={config}
      judgeId={judgeId ?? undefined}
      onScoreSubmit={handleScoreSubmit}
      configSaved={configSaved}
      timer={timer}
      isChiefJudge={false}
    />
  );
}

function DisplayWrapper() {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<AppConfig>(() => parseStoredConfig());
  const [configSaved, setConfigSaved] = useState(() => localStorage.getItem('surfJudgingConfigSaved') === 'true');
  const [timer, setTimer] = useState<HeatTimer>(() => {
    try {
      const raw = localStorage.getItem('surfJudgingTimer');
      if (raw) {
        return normaliseTimerSnapshot(JSON.parse(raw));
      }
    } catch (e) { }
    return DEFAULT_TIMER;
  });
  const [scores, setScores] = useState<Score[]>(() => {
    try {
      const raw = localStorage.getItem('surfJudgingScores');
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return [];
  });
  const [heatStatus, setHeatStatus] = useState<'waiting' | 'running' | 'paused' | 'finished'>('waiting');

  useEffect(() => {
    const configParam = searchParams.get('config');
    if (!configParam) return;

    try {
      const decoded = JSON.parse(atob(configParam));
      const { timerSnapshot, configSaved: savedFlag, heatStatus: sharedHeatStatus, judgeNames, ...rest } = decoded;
      const nextConfig = normaliseConfigData({
        ...rest,
        judgeNames: judgeNames || {}
      });

      setConfig(nextConfig);
      try { localStorage.setItem('surfJudgingConfig', JSON.stringify(nextConfig)); } catch { }

      const saved = savedFlag !== undefined ? Boolean(savedFlag) : true;
      setConfigSaved(saved);
      localStorage.setItem('surfJudgingConfigSaved', saved ? 'true' : 'false');

      if (timerSnapshot) {
        const nextTimer = normaliseTimerSnapshot(timerSnapshot);
        setTimer(nextTimer);
        try {
          localStorage.setItem('surfJudgingTimer', JSON.stringify({
            ...nextTimer,
            startTime: nextTimer.startTime ? nextTimer.startTime.toISOString() : null
          }));
        } catch { }
      }

      if (sharedHeatStatus && typeof sharedHeatStatus === 'string') {
        setHeatStatus(sharedHeatStatus as typeof heatStatus);
      }
    } catch (error) {
      console.error('❌ Impossible de décoder la configuration affichage depuis l’URL:', error);
    }
  }, [searchParams]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      if (event.key === 'surfJudgingTimer') {
        try {
          const nextTimer = normaliseTimerSnapshot(JSON.parse(event.newValue));
          setTimer(nextTimer);
        } catch (error) {
          console.warn('⚠️ Impossible de mettre à jour le timer (affichage):', error);
        }
      } else if (event.key === 'surfJudgingConfig') {
        try {
          const nextConfig = normaliseConfigData(JSON.parse(event.newValue));
          setConfig(nextConfig);
        } catch (error) {
          console.warn('⚠️ Impossible de mettre à jour la config (affichage):', error);
        }
      } else if (event.key === 'surfJudgingScores') {
        try {
          const nextScores = JSON.parse(event.newValue);
          setScores(nextScores);
        } catch (error) {
          console.warn('⚠️ Impossible de mettre à jour les scores (affichage):', error);
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Subscribe to realtime updates for remote displays
  const { subscribeToHeat } = useRealtimeSync();
  useEffect(() => {
    if (!config.competition) return;
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

    console.log('📡 Display subscribing to heat:', heatId);
    const unsubscribe = subscribeToHeat(heatId, (newTimer, newConfig) => {
      if (newTimer) {
        setTimer(newTimer);
      }
      if (newConfig) {
        console.log('📡 Display received config update:', newConfig);
        setConfig(prev => {
          const next = { ...prev, ...newConfig } as AppConfig;
          if (!next.surferNames && prev.surferNames) next.surferNames = prev.surferNames;
          return next;
        });
        setConfigSaved(true);
      }
    });

    return unsubscribe;
  }, [config.competition, config.division, config.round, config.heatId, subscribeToHeat]);

  return (
    <ScoreDisplay
      config={config}
      scores={scores}
      timer={timer}
      configSaved={configSaved}
      heatStatus={heatStatus}
    />
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />
  },
  {
    path: '/create-event',
    element: <CreateEvent />
  },
  {
    path: '/my-events',
    element: <MyEventsPage />
  },
  {
    path: '/payment',
    element: <PaymentPage />
  },
  {
    path: '/participants',
    element: <ParticipantsPage />
  },
  {
    path: '/generate-heats',
    element: <GenerateHeatsPage />
  },
  {
    path: '/chief-judge',
    element: <ChiefJudgeWrapper />
  },
  {
    path: '/judge',
    element: <JudgeWrapper />
  },
  {
    path: '/display',
    element: <DisplayWrapper />
  }
]);
