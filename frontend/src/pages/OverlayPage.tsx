import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ObsOverlay from '../components/ObsOverlay';
import { DEFAULT_TIMER_DURATION } from '../utils/constants';
import type { AppConfig, HeatTimer, Score } from '../types';

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
  totalRounds: 1,
};

const DEFAULT_TIMER: HeatTimer = {
  isRunning: false,
  startTime: null,
  duration: DEFAULT_TIMER_DURATION,
};

function normaliseConfigData(data: Partial<AppConfig>): AppConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...data,
    judges: data.judges && data.judges.length ? data.judges : DEFAULT_CONFIG.judges,
    surfers: data.surfers && data.surfers.length ? data.surfers : DEFAULT_CONFIG.surfers,
    judgeNames: { ...DEFAULT_CONFIG.judgeNames, ...(data.judgeNames || {}) },
    surferNames: { ...DEFAULT_CONFIG.surferNames, ...(data.surferNames || {}) },
    surferCountries: { ...DEFAULT_CONFIG.surferCountries, ...(data.surferCountries || {}) },
  };

  return {
    ...merged,
    tournamentType: merged.tournamentType === 'repechage' ? 'repechage' : 'elimination',
    totalSurfers: data.totalSurfers ?? merged.totalSurfers ?? merged.surfers.length,
    surfersPerHeat: data.surfersPerHeat ?? merged.surfersPerHeat ?? merged.surfers.length,
    totalHeats: data.totalHeats ?? merged.totalHeats,
    totalRounds: data.totalRounds ?? merged.totalRounds,
  };
}

function normaliseTimerSnapshot(
  snapshot:
    | (Partial<HeatTimer> & {
        start_time?: string | null;
        duration_minutes?: number;
        is_running?: boolean;
      })
    | null
): HeatTimer {
  if (!snapshot) return DEFAULT_TIMER;

  const durationCandidate = Number(
    snapshot.duration ?? snapshot.duration_minutes ?? DEFAULT_TIMER.duration
  );
  const duration =
    Number.isFinite(durationCandidate) && durationCandidate > 0
      ? durationCandidate
      : DEFAULT_TIMER.duration;

  const start = snapshot.startTime ?? snapshot.start_time ?? null;

  return {
    isRunning: Boolean(snapshot.isRunning ?? snapshot.is_running ?? false),
    startTime: start ? new Date(start) : null,
    duration,
  };
}

function readStoredConfig(): AppConfig {
  try {
    const raw = localStorage.getItem('surfJudgingConfig');
    if (!raw) return DEFAULT_CONFIG;

    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CONFIG;

    return normaliseConfigData(parsed);
  } catch (error) {
    console.warn('Impossible de lire la configuration OBS locale:', error);
    return DEFAULT_CONFIG;
  }
}

function readStoredTimer(): HeatTimer {
  try {
    const raw = localStorage.getItem('surfJudgingTimer');
    if (raw) return normaliseTimerSnapshot(JSON.parse(raw));
  } catch (error) {
    console.warn('Impossible de lire le timer OBS local:', error);
  }

  return DEFAULT_TIMER;
}

function readStoredScores(): Score[] {
  try {
    const raw = localStorage.getItem('surfJudgingScores');
    if (raw) return JSON.parse(raw) as Score[];
  } catch (error) {
    console.warn('Impossible de lire les scores OBS locaux:', error);
  }

  return [];
}

export default function OverlayPage() {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<AppConfig>(() => readStoredConfig());
  const [timer, setTimer] = useState<HeatTimer>(() => readStoredTimer());
  const [scores, setScores] = useState<Score[]>(() => readStoredScores());
  const [heatStatus, setHeatStatus] = useState<'waiting' | 'running' | 'paused' | 'finished'>(
    'waiting'
  );

  useEffect(() => {
    const configParam = searchParams.get('config');
    if (!configParam) return;

    try {
      const decoded = JSON.parse(atob(configParam)) as Partial<AppConfig> & {
        surfer_names?: Record<string, string>;
        surfer_countries?: Record<string, string>;
        heatStatus?: 'waiting' | 'running' | 'paused' | 'finished';
        timerSnapshot?: Parameters<typeof normaliseTimerSnapshot>[0];
      };

      const {
        timerSnapshot,
        heatStatus: sharedHeatStatus,
        judgeNames,
        surfer_names: sharedSurferNames,
        surfer_countries: sharedSurferCountries,
        ...rest
      } = decoded;
      const nextConfig = normaliseConfigData({
        ...rest,
        judgeNames: judgeNames || {},
        surferNames: decoded.surferNames || sharedSurferNames || {},
        surferCountries: decoded.surferCountries || sharedSurferCountries || {},
      });

      setConfig(nextConfig);
      localStorage.setItem('surfJudgingConfig', JSON.stringify(nextConfig));

      if (timerSnapshot) {
        const nextTimer = normaliseTimerSnapshot(timerSnapshot);
        setTimer(nextTimer);
        localStorage.setItem(
          'surfJudgingTimer',
          JSON.stringify({
            ...nextTimer,
            startTime: nextTimer.startTime ? nextTimer.startTime.toISOString() : null,
          })
        );
      }

      if (sharedHeatStatus) {
        setHeatStatus(sharedHeatStatus);
      }
    } catch (error) {
      console.error('Impossible de décoder la configuration OBS depuis l’URL:', error);
    }
  }, [searchParams]);

  useEffect(() => {
    const syncFromLocalStorage = () => {
      setConfig(readStoredConfig());
      setTimer(readStoredTimer());
      setScores(readStoredScores());
    };

    syncFromLocalStorage();

    const interval = window.setInterval(syncFromLocalStorage, 2000);

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === 'surfJudgingTimer' ||
        event.key === 'surfJudgingConfig' ||
        event.key === 'surfJudgingScores'
      ) {
        syncFromLocalStorage();
      }
    };

    const handleRealtimeScore = (event: Event) => {
      const newScore = (event as CustomEvent<Score>).detail;
      if (!newScore) return;

      setScores((currentScores) => {
        if (newScore.id && currentScores.some((score) => score.id === newScore.id)) {
          return currentScores;
        }

        return [...currentScores, { ...newScore, score: Number(newScore.score) }];
      });
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('newScoreRealtime', handleRealtimeScore);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('newScoreRealtime', handleRealtimeScore);
    };
  }, []);

  return <ObsOverlay config={config} scores={scores} timer={timer} heatStatus={heatStatus} />;
}
