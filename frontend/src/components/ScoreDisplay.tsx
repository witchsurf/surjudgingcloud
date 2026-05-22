import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { Users, Trophy, FileText } from 'lucide-react';
import HeatTimer from './HeatTimer';
import { calculateSurferStats, getEffectiveJudgeCount } from '../utils/scoring';
import { exportHeatScorecardPdf } from '../utils/pdfExport';
import { fetchInterferenceCalls } from '../api/supabaseClient';
import { getScoreJudgeStation } from '../api/modules/scoring.api';
import { computeEffectiveInterferences } from '../utils/interference';
import { getHeatIdentifiers } from '../utils/heat';
import { subscribeToHeatInterference } from '../lib/sharedHeatTableSubscriptions';
import { getPriorityLabels, normalizePriorityState } from '../utils/priority';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { useHeatParticipantDetails } from '../hooks/useHeatParticipantDetails';

import type {
  AppConfig,
  EffectiveInterference,
  EventTopScoreEntry,
  Score,
  SurferStats,
  HeatTimer as HeatTimerType,
} from '../types';

interface ScoreDisplayProps {
  config: AppConfig;
  scores: Score[];
  timer: HeatTimerType;
  configSaved: boolean;
  heatStatus?: 'waiting' | 'running' | 'paused' | 'finished' | 'closed';
  eventTopScores?: EventTopScoreEntry[];
  eventTopScoresOpen?: boolean;
  eventTopScoresLoading?: boolean;
  onToggleEventTopScores?: () => void;
}

// Couleurs officielles
const LYCRA: Record<string, { badge: string; bg: string; text: string }> = {
  ROUGE: { badge: 'bg-red-500', bg: 'bg-red-500', text: 'text-white' },
  BLEU: { badge: 'bg-blue-500', bg: 'bg-blue-500', text: 'text-white' },
  BLANC: { badge: 'bg-white ring-2 ring-primary-950/20 shadow-inner', bg: 'bg-slate-50', text: 'text-slate-900' },
  JAUNE: { badge: 'bg-yellow-400', bg: 'bg-yellow-400', text: 'text-slate-900' },
  NOIR: { badge: 'bg-gray-900', bg: 'bg-gray-900', text: 'text-white' },
  VERT: { badge: 'bg-green-500', bg: 'bg-green-500', text: 'text-white' },
  // English keys support
  RED: { badge: 'bg-red-500', bg: 'bg-red-500', text: 'text-white' },
  BLUE: { badge: 'bg-blue-500', bg: 'bg-blue-500', text: 'text-white' },
  WHITE: { badge: 'bg-white ring-2 ring-primary-950/20 shadow-inner', bg: 'bg-slate-50', text: 'text-slate-900' },
  YELLOW: { badge: 'bg-yellow-400', bg: 'bg-yellow-400', text: 'text-slate-900' },
  BLACK: { badge: 'bg-gray-900', bg: 'bg-gray-900', text: 'text-white' },
  GREEN: { badge: 'bg-green-500', bg: 'bg-green-500', text: 'text-white' },
};

function lycraStyle(label: string) {
  const key = label.trim().toUpperCase();
  return (
    LYCRA[key] || {
      badge: 'bg-gray-300',
      bg: 'bg-white',
      text: 'text-gray-900',
    }
  );
}

function normalizePriorityKey(label?: string) {
  const raw = (label || '').trim().toUpperCase();
  if (!raw) return '';
  return colorLabelMap[raw as HeatColor] ?? raw;
}

function getPriorityBadgeTextClass(label?: string) {
  const normalized = normalizePriorityKey(label);
  return normalized === 'BLANC' || normalized === 'WHITE'
    ? 'text-primary-950 font-extrabold drop-shadow-none'
    : 'text-white';
}

function getPriorityBadgeTextStyle(label?: string): CSSProperties {
  const normalized = normalizePriorityKey(label);
  const needsDarkText = normalized === 'BLANC' || normalized === 'WHITE' || normalized === 'JAUNE' || normalized === 'YELLOW';

  return {
    color: needsDarkText ? '#0f172a' : '#ffffff',
    fontWeight: 1000,
    textShadow: needsDarkText ? '0 1px 0 rgba(255,255,255,0.8)' : '0 2px 3px rgba(0,0,0,0.75)',
    WebkitTextStroke: needsDarkText ? '0.35px rgba(15,23,42,0.55)' : '0.25px rgba(0,0,0,0.45)',
  };
}

type NeededScoreInfo = {
  needed: number;
  targetRank: number;
  label: 'to 1st' | 'to ADV';
};

function computeNeededScores(stats: SurferStats[]): Record<string, NeededScoreInfo> {
  const result: Record<string, NeededScoreInfo> = {};
  if (!stats.length) return result;

  const ordered = [...stats]
    .filter((s) => typeof s.rank === 'number')
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  const leader = ordered.find((s) => s.rank === 1);
  const second = ordered.find((s) => s.rank === 2);

  const computeFor = (
    surfer: SurferStats,
    target: SurferStats | undefined,
    targetRank: number
  ) => {
    if (!target) return;

    const completed = surfer.waves.filter((w) => w.isComplete && w.score > 0);
    const currentBest = completed.length
      ? Math.max(...completed.map((w) => w.score))
      : 0;

    const targetTotal = target.bestTwo ?? 0;
    const rawNeeded = targetTotal - currentBest + 0.01;
    const needed = Math.min(rawNeeded, 10);

    if (needed > 0) {
      result[surfer.surfer] = {
        needed,
        targetRank,
        label: targetRank === 1 ? 'to 1st' : 'to ADV'
      };
    }
  };

  ordered.forEach((surfer) => {
    if (surfer.rank === 2) {
      // 2e cherche à passer 1er
      computeFor(surfer, leader, 1);
    } else if ((surfer.rank ?? 99) > 2) {
      // 3e, 4e… cherchent à se qualifier (passer 2e)
      computeFor(surfer, second, 2);
    }
  });

  return result;
}

function getWinByDiff(stats: SurferStats[]): number | null {
  if (!stats.length) return null;

  const ordered = [...stats]
    .filter((s) => typeof s.rank === 'number')
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  const leader = ordered.find((s) => s.rank === 1);
  const second = ordered.find((s) => s.rank === 2);

  if (!leader || !second) return null;

  const diff = (leader.bestTwo ?? 0) - (second.bestTwo ?? 0);
  return diff > 0 ? diff : null;
}

const SEED_ORDER = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'];

const getSeedPriority = (color: string) => {
  const index = SEED_ORDER.indexOf(color.toUpperCase());
  return index === -1 ? 99 : index;
};

const sortStats = (a: SurferStats, b: SurferStats) => {
  const rankDiff = (a.rank ?? 99) - (b.rank ?? 99);
  if (rankDiff !== 0) return rankDiff;
  return getSeedPriority(a.surfer) - getSeedPriority(b.surfer);
};

export default function ScoreDisplay({
  config,
  scores,
  timer,
  configSaved,
  heatStatus = 'waiting',
  eventTopScores = [],
  eventTopScoresOpen = false,
  eventTopScoresLoading = false,
  onToggleEventTopScores,
}: ScoreDisplayProps) {
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [surferStats, setSurferStats] = useState<SurferStats[]>([]);
  const [eventData, setEventData] = useState<Record<string, any> | null>(null);
  const [effectiveInterferences, setEffectiveInterferences] = useState<EffectiveInterference[]>([]);
  const { normalized: heatId } = getHeatIdentifiers(
    config.competition,
    config.division,
    config.round,
    config.heatId
  );
  const shouldLoadParticipantDetails = Boolean(
    configSaved
      && heatId
      && (
        Object.keys(config.surferNames ?? {}).length === 0
        || Object.keys(config.surferCountries ?? {}).length === 0
      )
  );
  const { entryMap: participantMap } = useHeatParticipantDetails({
    heatId: shouldLoadParticipantDetails ? heatId : null,
    surfers: config.surfers || [],
    enabled: shouldLoadParticipantDetails,
  });

  // Load eventData for PDF export
  useEffect(() => {
    try {
      const stored = localStorage.getItem('eventData');
      if (stored) {
        setEventData(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading eventData', e);
    }
  }, []);

  // Pour les noms et pays, on lit des champs optionnels du config si présents
  const surferNames = config.surferNames ?? {};
  const surferCountries = config.surferCountries ?? {};
  const priorityState = useMemo(
    () => normalizePriorityState(config.priorityState, config.surfers || []),
    [config.priorityState, config.surfers]
  );
  const priorityLabels = useMemo(
    () => getPriorityLabels(priorityState, config.surfers || []),
    [priorityState, config.surfers]
  );
  const isPriorityActive =
    priorityState.mode === 'equal' ||
    priorityState.mode === 'opening' ||
    priorityState.mode === 'ordered';

  // Mise à jour horodatage
  useEffect(() => {
    setLastUpdate(new Date());
  }, [scores]);

  useEffect(() => {
    if (!configSaved || !heatId) {
      setEffectiveInterferences([]);
      return;
    }

    let cancelled = false;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const refreshInterferences = async () => {
      try {
        const calls = await fetchInterferenceCalls(heatId);
        if (cancelled) return;
        const observedJudgeCount = new Set(
          scores
            .map((score) => getScoreJudgeStation(score))
            .filter(Boolean)
        ).size;
        const effectiveJudgeCount = observedJudgeCount > 0 ? observedJudgeCount : Math.max(config.judges.length, 1);
        const computed = computeEffectiveInterferences(calls, effectiveJudgeCount);
        setEffectiveInterferences(computed);
      } catch (error) {
        if (!cancelled) {
          console.warn('Impossible de charger les interférences du heat', error);
          setEffectiveInterferences([]);
        }
      }
    };

    refreshInterferences();

    const unsubscribe = subscribeToHeatInterference(heatId, () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        void refreshInterferences();
      }, 120);
    });

    return () => {
      cancelled = true;
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      unsubscribe();
    };
  }, [configSaved, heatId, config.judges.length, scores]);

  // Calcul des stats
  useEffect(() => {
    if (!configSaved) return;
    if (!config || !config.surfers) return;

    const judgeCount = getEffectiveJudgeCount(scores, config.judges.length);
    const stats = calculateSurferStats(
      scores,
      config.surfers,
      judgeCount,
      config.waves,
      false,
      effectiveInterferences,
      heatStatus
    );
    setSurferStats(stats);
  }, [scores, configSaved, config, heatStatus, effectiveInterferences]);

  if (!config?.competition) {
    return (
      <div className="max-w-6xl mx-auto p-6 text-center text-blue-800">
        ⚙️ En attente de configuration valide...
      </div>
    );
  }

  const hasScores = scores.length > 0;
  const hasStats = surferStats.length > 0;
  const maxWaves = Math.max(
    ...surferStats.map((s) => s.waves.length),
    config.waves,
    1
  );

  const neededScores = computeNeededScores(surferStats);
  const winBy = getWinByDiff(surferStats);
  const fallbackRows = (config.surfers || []).map((surfer) => ({
    surfer,
    displayName: (() => {
      const key = normalizePriorityKey(surfer);
      const participant = participantMap.get(key);
      if (participant && participant.name && participant.name !== participant.jersey) {
        return participant.name;
      }
      return surferNames?.[surfer] ?? surfer;
    })(),
    country: (() => {
      const key = normalizePriorityKey(surfer);
      const participant = participantMap.get(key);
      return participant?.country ?? surferCountries?.[surfer];
    })(),
    priorityKey: normalizePriorityKey(surfer),
  }));
  const compactLayout = maxWaves >= 12;
  const ultraCompactLayout = maxWaves >= 18;

  return (
    <div className="score-display w-full max-w-none mx-auto p-2 sm:p-4 lg:p-5 space-y-4 font-sans bg-hud-black min-h-screen text-slate-100">
      {/* HEADER WITH TIMER */}
      <div className="bg-slate-950/60 backdrop-blur-md border border-white/10 rounded-2xl p-3 sm:p-4 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-3 sticky top-2 z-50">
        <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full -mr-16 -mt-16 blur-3xl" />
        
        {/* Left: Title & Badges */}
        <div className="relative z-10 flex-1 w-full md:w-auto text-center md:text-left">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bebas tracking-widest text-slate-100 leading-none mb-2">
            {config.competition}
          </h1>
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded border border-white/10">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              {config.division}
            </span>
            <span className="px-2 py-1 bg-white/5 rounded border border-white/10 text-cyan-400">Round {config.round}</span>
            <span className="px-2 py-1 bg-white/5 rounded border border-white/10 text-cyan-400">Heat {config.heatId}</span>
          </div>
        </div>

        {/* Center: Compact Timer */}
        <div className="relative z-10 flex-shrink-0 w-full md:w-auto flex justify-center mt-2 md:mt-0">
          <div className="w-full max-w-[360px] md:max-w-[420px]">
            <HeatTimer
              timer={timer}
              onStart={() => { }}
              onPause={() => { }}
              onReset={() => { }}
              onDurationChange={() => { }}
              showControls={false}
              size="small"
              compact={true}
              landscape={true}
              configSaved={configSaved}
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="relative z-10 w-full md:w-auto flex flex-row md:flex-col items-center justify-between md:items-end gap-3 border-t md:border-t-0 border-white/5 pt-3 md:pt-0 mt-2 md:mt-0">
          <div className="text-left md:text-right space-y-0.5">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] leading-none">Dernière maj</div>
            <div className="font-bebas text-xl text-slate-100 tracking-widest leading-none">
              {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void exportHeatScorecardPdf({ config, scores, heatStatus, eventData }); }}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg border border-cyan-500/50 text-[10px] font-bold uppercase tracking-widest transition-all hover:-translate-y-0.5 shadow-lg"
          >
            <FileText className="w-3.5 h-3.5" />
            PDF Scorecard
          </button>
          {onToggleEventTopScores && (
            <button
              type="button"
              onClick={onToggleEventTopScores}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-100 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest transition-all hover:-translate-y-0.5 shadow-lg"
            >
              <Trophy className="w-3.5 h-3.5 text-yellow-400" />
              Top notes event
            </button>
          )}
        </div>
      </div>

      {onToggleEventTopScores && eventTopScoresOpen && (
        <div className="neon-card rounded-2xl shadow-2xl overflow-hidden border border-white/10">
          <div className="bg-slate-950/80 px-4 sm:px-6 py-3 border-b border-white/10 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-bebas tracking-widest text-slate-100 flex items-center gap-3">
                <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400" />
                Meilleures notes de l'event
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">
                Surfeur, categorie, round et heat
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleEventTopScores}
              className="px-3 py-1.5 bg-slate-900 text-slate-100 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800"
            >
              Fermer
            </button>
          </div>

          {eventTopScoresLoading ? (
            <div className="p-6 text-sm text-slate-400">Chargement des meilleures notes...</div>
          ) : eventTopScores.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">Aucune note disponible pour cet event.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {eventTopScores.map((entry, index) => (
                <div key={entry.scoreId || `${entry.heatId}-${entry.surfer}-${entry.waveNumber}-${index}`} className="px-4 py-3 grid grid-cols-[1fr_auto] gap-3 items-center">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-full bg-cyan-600/30 border border-cyan-500/50 text-cyan-300 text-[10px] font-bold uppercase tracking-widest">
                        #{index + 1}
                      </span>
                      <span className="text-base sm:text-lg font-bebas tracking-wider text-slate-100">{entry.surferName}</span>
                      {entry.surferName.trim().toUpperCase() !== entry.surfer.trim().toUpperCase() && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{entry.surfer}</span>
                      )}
                      {entry.country && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{entry.country}</span>
                      )}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">
                      {entry.division} · R{entry.round} · H{entry.heatNumber} · Vague {entry.waveNumber}
                    </div>
                    <div className="text-xs text-slate-500">Note panel apres moyenne des juges</div>
                  </div>
                  <div className="text-right pl-2">
                    <div className="text-2xl sm:text-3xl font-bebas text-slate-100 tracking-tighter leading-none">
                      {entry.score.toFixed(2)}
                    </div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                      Top score
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {heatStatus === 'closed' && (
        <div className="bg-red-950/60 border border-red-500/30 backdrop-blur-md rounded-2xl px-6 py-4 shadow-2xl text-center">
          <div className="text-red-400 font-bebas tracking-[0.25em] text-3xl sm:text-5xl leading-none">
            HEAT OVER
          </div>
        </div>
      )}

      {/* CLASSEMENT */}
      <div className="neon-card rounded-2xl shadow-2xl overflow-hidden border border-white/5 transition-all">
        <div className="bg-slate-950/60 px-4 sm:px-6 py-3 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-bebas tracking-widest text-slate-100 flex items-center gap-3">
            <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400" />
            Classement PRO Live
          </h2>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Temps réel</span>
          </div>
        </div>

        {!hasScores && !hasStats && fallbackRows.length > 0 && (
          <div className="divide-y divide-white/5">
            {fallbackRows.map((row) => {
              const style = lycraStyle(row.surfer);
              const colorKey = normalizePriorityKey(row.surfer).toUpperCase();
              const priorityBadge = priorityLabels[row.priorityKey] || (priorityState.mode === 'equal' ? '=' : '');
              const isInFlight = (priorityState.mode === 'ordered' || priorityState.mode === 'opening') && priorityState.inFlight.includes(row.priorityKey);

              return (
                <div key={row.surfer} className="p-3 border-b border-white/5 last:border-b-0">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
                    <div className="flex items-center gap-4 sm:gap-6">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full ${style.badge} neon-glow-${colorKey} flex items-center justify-center`}>
                            {isPriorityActive && !isInFlight && priorityBadge && (
                              <span className={`${getPriorityBadgeTextClass(row.surfer)} text-xl sm:text-2xl leading-none`} style={getPriorityBadgeTextStyle(row.surfer)}>{priorityBadge}</span>
                            )}
                          </div>
                          <div className="absolute -bottom-1 -right-1 bg-slate-950 border border-white/10 rounded-full p-0.5">
                            <div className="w-2.5 h-2.5 bg-yellow-400 rounded-full" />
                          </div>
                        </div>

                        <div className="space-y-0.5">
                          <h3 className="text-lg sm:text-2xl font-bebas tracking-wider text-slate-100 leading-none flex items-center gap-2">
                            {row.displayName}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {row.country && (
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{row.country}</span>
                            )}
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                              {row.surfer}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-[80px] text-right ml-16 sm:ml-0">
                      <div className="text-3xl sm:text-5xl font-bebas text-slate-600 tracking-tighter leading-none">
                        --
                      </div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">En attente</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasScores && !hasStats && (
          <div className="p-12 text-center italic text-slate-400">
            Calcul des statistiques en cours...
          </div>
        )}

        {hasStats && (
          <div className="divide-y divide-white/5">
            {surferStats
              .slice()
              .sort(sortStats)
              .map((stat) => {
                const style = lycraStyle(stat.surfer);
                const colorKey = normalizePriorityKey(stat.surfer).toUpperCase();
                const completedWaves = stat.waves.filter(
                  (w) => w.isComplete && w.score > 0
                );
                const bestWaveScores = completedWaves
                  .map((wave) => wave.score)
                  .sort((a, b) => b - a);
                const bestWave = bestWaveScores[0] ?? null;
                const secondBestWave = bestWaveScores[1] ?? null;
                const wavesCount = completedWaves.length;
                const participantKey = normalizePriorityKey(stat.surfer);
                const participant = participantMap.get(participantKey);
                const displayName = (participant?.name && participant.name !== participant.jersey)
                  ? participant.name
                  : (surferNames?.[stat.surfer] ?? stat.surfer);
                const country = participant?.country ?? surferCountries?.[stat.surfer];
                const neededInfo = neededScores[stat.surfer];
                const hasPendingScores = stat.waves.some(w => !w.isComplete && Object.keys(w.judgeScores).length > 0);
                const priorityKey = normalizePriorityKey(stat.surfer);
                const priorityBadge = priorityLabels[priorityKey] || (priorityState.mode === 'equal' ? '=' : '');
                const isInFlight = (priorityState.mode === 'ordered' || priorityState.mode === 'opening') && priorityState.inFlight.includes(priorityKey);

                return (
                  <div key={stat.surfer} className="p-3 hover:bg-slate-900/30 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
                      {/* Bloc gauche: rang + avatar + nom */}
                      <div className="flex items-center gap-4 sm:gap-6">
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full ${style.badge} neon-glow-${colorKey} flex items-center justify-center`}>
                              {isPriorityActive && !isInFlight && priorityBadge && (
                                <span className={`${getPriorityBadgeTextClass(stat.surfer)} text-xl sm:text-2xl leading-none`} style={getPriorityBadgeTextStyle(stat.surfer)}>{priorityBadge}</span>
                              )}
                            </div>
                            <div className="absolute -bottom-1 -right-1 bg-slate-950 border border-white/10 rounded-full p-0.5">
                              <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                            </div>
                          </div>
                          
                          <div className="space-y-0.5">
                            <h3 className="text-lg sm:text-2xl font-bebas tracking-wider text-slate-100 leading-none flex items-center gap-2">
                              {displayName}
                              {hasPendingScores && (
                                <span className="text-red-500 animate-pulse text-3xl leading-none pt-1" title="En attente de notes">*</span>
                              )}
                            </h3>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              {country && (
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{country}</span>
                              )}
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                {wavesCount} VAGUE{wavesCount > 1 ? 'S' : ''}
                              </span>
                              {stat.isDisqualified ? (
                                <span className="text-[10px] font-bold bg-red-600 text-white px-2 py-0.5 rounded uppercase tracking-tighter">DSQ</span>
                              ) : stat.interferenceCount && stat.interferenceCount > 0 ? (
                                <span className="text-[10px] font-bold bg-amber-500 text-slate-950 px-2 py-0.5 rounded uppercase tracking-tighter">
                                  INT <span className="opacity-70 text-[9px] ml-0.5">{stat.interferenceCount}</span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bloc droit: score total + analytics */}
                      <div className="flex items-center gap-4 sm:gap-6 text-right ml-16 sm:ml-0">
                        <div className="space-y-1">
                          {stat.rank === 1 && winBy != null && (
                            <div className="text-[10px] font-bold text-green-400 bg-green-950/40 px-2 py-0.5 rounded-full border border-green-500/30 uppercase tracking-widest inline-block">
                              Lead +{winBy.toFixed(2)}
                            </div>
                          )}
                          {neededInfo && (
                            <div className="text-[10px] font-bold text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded-full border border-cyan-500/30 uppercase tracking-widest flex items-center gap-1 justify-end">
                              Need <span className="font-bebas text-sm">{neededInfo.needed.toFixed(2)}</span>
                              <span>{neededInfo.label}</span>
                            </div>
                          )}
                        </div>

                        <div className="min-w-[116px] sm:min-w-[136px]">
                          <div className="rounded-xl border border-white/10 overflow-hidden bg-slate-950/60 shadow-md">
                            <div className="grid grid-cols-2 bg-slate-900/80 text-slate-300 text-[10px] sm:text-xs">
                              <div className="px-2 py-1 text-center font-bebas text-lg sm:text-xl leading-none tracking-wide border-r border-white/5">V1</div>
                              <div className="px-2 py-1 text-center font-bebas text-lg sm:text-xl leading-none tracking-wide">V2</div>
                            </div>
                            <div className="grid grid-cols-2 text-slate-100">
                              <div className="px-2 py-1.5 text-center font-black text-xl sm:text-2xl leading-none border-r border-white/5">
                                {bestWave != null ? bestWave.toFixed(2) : '--'}
                              </div>
                              <div className="px-2 py-1.5 text-center font-black text-xl sm:text-2xl leading-none">
                                {secondBestWave != null ? secondBestWave.toFixed(2) : '--'}
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="min-w-[80px]">
                          <div className="text-3xl sm:text-5xl font-bebas text-slate-100 tracking-tighter leading-none">
                            {(stat.bestTwo ?? 0).toFixed(2)}
                          </div>
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Total (B2)</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* TABLEAU DES VAGUES */}
      {hasStats && (
        <div className="neon-card rounded-2xl shadow-2xl overflow-hidden border border-white/5">
          <div className="overflow-x-auto">
            <table className={`w-full table-fixed font-bold uppercase tracking-wider ${ultraCompactLayout ? 'text-[10px]' : compactLayout ? 'text-[11px]' : 'text-xs'}`}>
              <thead>
                <tr className="bg-slate-950/80 text-slate-100 border-b border-white/10">
                  <th className={`${ultraCompactLayout ? 'p-2 w-32 text-sm' : compactLayout ? 'p-2.5 w-36 text-base' : 'p-4 text-lg'} text-left font-bebas tracking-widest`}>SURFEUR</th>
                  {Array.from({ length: maxWaves }).map((_, i) => (
                    <th key={i} className={`${ultraCompactLayout ? 'p-1.5 text-[11px]' : compactLayout ? 'p-2 text-sm' : 'p-4 text-lg'} text-center font-bebas tracking-widest opacity-60`}>V{i + 1}</th>
                  ))}
                  <th className={`${ultraCompactLayout ? 'p-2 w-16 text-sm' : compactLayout ? 'p-2.5 w-20 text-base' : 'p-4 text-lg'} text-center font-bebas tracking-widest bg-cyan-900/60 text-cyan-200 border-l border-white/5`}>BEST 2</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {surferStats
                  .slice()
                  .sort(sortStats)
                  .map((stat) => {
                    const participantKey = normalizePriorityKey(stat.surfer);
                    const participant = participantMap.get(participantKey);
                    const displayName = (participant?.name && participant.name !== participant.jersey)
                      ? participant.name
                      : (surferNames?.[stat.surfer] ?? stat.surfer);
                    const country = participant?.country ?? surferCountries?.[stat.surfer];

                    return (
                      <tr key={stat.surfer} className="hover:bg-slate-900/20 transition-colors">
                        <td className={ultraCompactLayout ? 'p-2' : compactLayout ? 'p-2.5' : 'p-4'}>
                          <div className="flex flex-col">
                            <span className={`${compactLayout ? 'text-xs sm:text-sm' : 'text-sm'} font-bebas tracking-wide text-slate-100 flex items-center gap-1`}>
                              {displayName}
                              {stat.waves.some(w => !w.isComplete && Object.keys(w.judgeScores).length > 0) && (
                                <span className="text-red-500 animate-pulse text-lg leading-none pt-0.5" title="En attente de notes">*</span>
                              )}
                            </span>
                            <span className={`${compactLayout ? 'text-[8px]' : 'text-[9px]'} text-slate-500`}>
                              {stat.surfer}{country ? ` • ${country}` : ''}
                            </span>
                          </div>
                        </td>

                        {Array.from({ length: maxWaves }).map((_, i) => {
                          const wave = stat.waves.find((w) => w.wave === i + 1);
                          return (
                            <td key={i} className={`${ultraCompactLayout ? 'p-1.5' : compactLayout ? 'p-2' : 'p-4'} text-center`}>
                              {wave && wave.score > 0 ? (
                                <div className="group relative cursor-help inline-block">
                                  <span className={`${compactLayout ? 'text-sm' : 'text-base'} font-bebas tracking-widest text-slate-100`}>
                                    {wave.score.toFixed(2)}
                                  </span>
                                  {/* Tooltip notes juges - Simplified style */}
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:flex flex-col items-center bg-slate-950 text-slate-100 text-[10px] p-2 rounded-xl z-50 shadow-2xl min-w-max border border-white/10">
                                    <div className="flex gap-4">
                                      {Object.entries(wave.judgeScores).map(([jKey, s], idx) => {
                                        if (s === undefined) return null;
                                        // Resolve display name: try config.judgeNames by key, then by station match
                                        const displayName = config.judgeNames[jKey]
                                          || config.judges.find((gId) => config.judgeNames[gId] && gId === jKey) && config.judgeNames[jKey]
                                          || `J${idx + 1}`;
                                        return (
                                          <div key={jKey} className="flex flex-col items-center">
                                            <span className="text-[8px] text-slate-400 uppercase leading-none mb-1">
                                              {displayName}
                                            </span>
                                            <span className="font-bebas text-lg leading-none">
                                              {s.toFixed(1)}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="w-2 h-2 bg-slate-950 rotate-45 absolute -bottom-1 border-r border-b border-white/10 shadow-block" />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-800">—</span>
                              )}
                            </td>
                          );
                        })}

                        <td className={`${ultraCompactLayout ? 'p-2' : compactLayout ? 'p-2.5' : 'p-4'} text-center bg-cyan-950/20 text-cyan-400 border-l border-white/5`}>
                          <span className={`${compactLayout ? 'text-lg' : 'text-2xl'} font-bebas tracking-widest`}>
                            {(stat.bestTwo ?? 0).toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export { ScoreDisplay };
