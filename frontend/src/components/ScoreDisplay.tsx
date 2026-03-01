import { useState, useEffect } from 'react';
import { Users, Trophy, FileText } from 'lucide-react';
import HeatTimer from './HeatTimer';
import HeatResults from './HeatResults';
import { calculateSurferStats, getEffectiveJudgeCount } from '../utils/scoring';
import { exportHeatScorecardPdf } from '../utils/pdfExport';
import { fetchInterferenceCalls } from '../api/supabaseClient';
import { computeEffectiveInterferences } from '../utils/interference';
import { getHeatIdentifiers } from '../utils/heat';
import { supabase } from '../lib/supabase';

import type {
  AppConfig,
  EffectiveInterference,
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
}

// Couleurs officielles
const LYCRA: Record<string, { badge: string; bg: string; text: string }> = {
  ROUGE: { badge: 'bg-red-500', bg: 'bg-red-500', text: 'text-white' },
  BLEU: { badge: 'bg-blue-500', bg: 'bg-blue-500', text: 'text-white' },
  BLANC: { badge: 'bg-white', bg: 'bg-slate-100', text: 'text-slate-900' },
  JAUNE: { badge: 'bg-yellow-400', bg: 'bg-yellow-400', text: 'text-slate-900' },
  NOIR: { badge: 'bg-gray-900', bg: 'bg-gray-900', text: 'text-white' },
  VERT: { badge: 'bg-green-500', bg: 'bg-green-500', text: 'text-white' },
  // English keys support
  RED: { badge: 'bg-red-500', bg: 'bg-red-500', text: 'text-white' },
  BLUE: { badge: 'bg-blue-500', bg: 'bg-blue-500', text: 'text-white' },
  WHITE: { badge: 'bg-white', bg: 'bg-slate-100', text: 'text-slate-900' },
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

type NeededScoreInfo = {
  needed: number;
  targetRank: number;
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
      result[surfer.surfer] = { needed, targetRank };
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
}: ScoreDisplayProps) {
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [surferStats, setSurferStats] = useState<SurferStats[]>([]);
  const [eventData, setEventData] = useState<any>(null);
  const [effectiveInterferences, setEffectiveInterferences] = useState<EffectiveInterference[]>([]);
  const { normalized: heatId } = getHeatIdentifiers(
    config.competition,
    config.division,
    config.round,
    config.heatId
  );

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
            .map((score) => (score.judge_id || '').trim().toUpperCase())
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

    const channel = supabase
      ?.channel(`interference_calls_${heatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'interference_calls',
          filter: `heat_id=eq.${heatId}`
        },
        () => {
          if (refreshTimeout) {
            clearTimeout(refreshTimeout);
          }
          refreshTimeout = setTimeout(() => {
            refreshInterferences();
          }, 120);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
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
      effectiveInterferences
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

  return (
    <div className="score-display max-w-7xl mx-auto p-4 sm:p-6 space-y-6 font-sans">
      {/* HEADER */}
      <div className="bg-primary-900 border-4 border-primary-950 rounded-2xl p-6 shadow-block relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-cta-500/10 rounded-full -mr-16 -mt-16 blur-3xl" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 relative z-10">
          <div>
            <h1 className="text-3xl sm:text-5xl font-bebas tracking-widest text-white leading-none mb-2">
              {config.competition}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-widest text-primary-200">
              <span className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded border border-white/10">
                <Users className="w-3.5 h-3.5 text-cta-500" />
                {config.division}
              </span>
              <span className="px-2 py-1 bg-white/5 rounded border border-white/10 text-cta-500">Round {config.round}</span>
              <span className="px-2 py-1 bg-white/5 rounded border border-white/10 text-cta-500">Heat {config.heatId}</span>
            </div>
          </div>

          <div className="text-left sm:text-right space-y-3">
            <div className="space-y-1">
              <div className="text-[10px] font-bold text-primary-300 uppercase tracking-[0.2em] leading-none">Dernière mise à jour</div>
              <div className="font-bebas text-2xl text-white tracking-widest">
                {lastUpdate.toLocaleTimeString('fr-FR')}
              </div>
            </div>

            <button
              type="button"
              onClick={() => exportHeatScorecardPdf({ config, scores, eventData })}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-cta-500 hover:bg-cta-600 text-white rounded-xl border-2 border-primary-950 shadow-block-orange text-xs font-bold uppercase tracking-widest transition-all hover:-translate-y-0.5"
            >
              <FileText className="w-4 h-4" />
              PDF Scorecard
            </button>
          </div>
        </div>
      </div>

      {/* TIMER */}
      <div className="flex justify-center -my-2">
        <div className="bg-white border-4 border-primary-950 px-8 py-2 rounded-2xl shadow-block min-w-[240px]">
          <HeatTimer
            timer={timer}
            onStart={() => { }}
            onPause={() => { }}
            onReset={() => { }}
            onDurationChange={() => { }}
            showControls={false}
            configSaved={configSaved}
          />
        </div>
      </div>

      {/* CLASSEMENT */}
      <div className="bg-white border-4 border-primary-950 rounded-2xl shadow-block overflow-hidden transition-all">
        <div className="bg-primary-900 px-6 py-4 border-b-4 border-primary-950 flex items-center justify-between">
          <h2 className="text-xl font-bebas tracking-widest text-white flex items-center gap-3">
            <Trophy className="w-6 h-6 text-cta-500" />
            Classement PRO Live
          </h2>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">Temps réel</span>
          </div>
        </div>

        {!hasScores && (
          <div className="p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mx-auto border-2 border-primary-100 italic text-2xl">?</div>
            <p className="font-bebas text-xl text-primary-300 tracking-wider">En attente des premières vagues...</p>
          </div>
        )}

        {hasScores && !hasStats && (
          <div className="p-12 text-center italic text-primary-400">
            Calcul des statistiques en cours...
          </div>
        )}

        {hasStats && (
          <div className="divide-y-2 divide-primary-50">
            {surferStats
              .slice()
              .sort(sortStats)
              .map((stat) => {
                const style = lycraStyle(stat.surfer);
                const completedWaves = stat.waves.filter(
                  (w) => w.isComplete && w.score > 0
                );
                const wavesCount = completedWaves.length;
                const displayName = surferNames?.[stat.surfer] ?? stat.surfer;
                const country = surferCountries?.[stat.surfer];
                const neededInfo = neededScores[stat.surfer];

                return (
                  <div
                    key={stat.surfer}
                    className="p-4 sm:p-6 hover:bg-primary-50/30 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                      {/* Bloc gauche: rang + avatar + nom */}
                      <div className="flex items-center gap-4 sm:gap-6">
                        <div className="w-12 h-12 flex items-center justify-center bg-primary-950 text-white rounded-xl border-2 border-primary-950 shadow-block text-2xl font-bebas tracking-tighter">
                          {stat.rank ?? '-'}
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <div className={`w-10 h-10 rounded-full border-4 border-primary-950 shadow-sm ${style.badge}`} />
                            <div className="absolute -bottom-1 -right-1 bg-white border-2 border-primary-950 rounded-full p-0.5">
                              <div className="w-2.5 h-2.5 bg-cta-500 rounded-full" />
                            </div>
                          </div>
                          
                          <div className="space-y-0.5">
                            <h3 className="text-xl sm:text-2xl font-bebas tracking-wider text-primary-900 leading-none">
                              {displayName}
                            </h3>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              {country && (
                                <span className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">{country}</span>
                              )}
                              <span className="text-[10px] font-bold text-primary-300 uppercase tracking-widest">
                                {wavesCount} VAGUE{wavesCount > 1 ? 'S' : ''}
                              </span>
                              {stat.isDisqualified && (
                                <span className="text-[10px] font-bold bg-danger-600 text-white px-2 py-0.5 rounded uppercase tracking-tighter">DSQ</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bloc droit: score total + analytics */}
                      <div className="flex items-center gap-6 text-right ml-16 sm:ml-0">
                        <div className="space-y-1">
                          {stat.rank === 1 && winBy != null && (
                            <div className="text-[10px] font-bold text-success-600 bg-success-50 px-2 py-0.5 rounded-full border border-success-100 uppercase tracking-widest inline-block">
                              Lead +{winBy.toFixed(2)}
                            </div>
                          )}
                          {neededInfo && (
                            <div className="text-[10px] font-bold text-cta-600 bg-cta-50 px-2 py-0.5 rounded-full border border-cta-100 uppercase tracking-widest flex items-center gap-1 justify-end">
                              Need <span className="font-bebas text-sm">{neededInfo.needed.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="min-w-[80px]">
                          <div className="text-4xl sm:text-5xl font-bebas text-primary-900 tracking-tighter leading-none">
                            {(stat.bestTwo ?? 0).toFixed(2)}
                          </div>
                          <div className="text-[9px] font-bold text-primary-300 uppercase tracking-widest mt-1">Total (B2)</div>
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
        <div className="bg-white border-4 border-primary-950 rounded-2xl shadow-block overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-bold uppercase tracking-wider">
              <thead>
                <tr className="bg-primary-900 text-white border-b-4 border-primary-950">
                  <th className="p-4 text-left font-bebas tracking-widest text-lg">SURFEUR</th>
                  {Array.from({ length: maxWaves }).map((_, i) => (
                    <th key={i} className="p-4 text-center font-bebas tracking-widest text-lg opacity-60">V{i + 1}</th>
                  ))}
                  <th className="p-4 text-center font-bebas tracking-widest text-lg bg-cta-600">BEST 2</th>
                </tr>
              </thead>

              <tbody className="divide-y-2 divide-primary-50">
                {surferStats
                  .slice()
                  .sort(sortStats)
                  .map((stat, idx) => {
                    const displayName = surferNames?.[stat.surfer] ?? stat.surfer;
                    const country = surferCountries?.[stat.surfer];

                    return (
                      <tr key={stat.surfer} className="hover:bg-primary-50/20 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bebas tracking-wide text-primary-900">
                              {displayName}
                            </span>
                            <span className="text-[9px] text-primary-300">
                              {stat.surfer}{country ? ` • ${country}` : ''}
                            </span>
                          </div>
                        </td>

                        {Array.from({ length: maxWaves }).map((_, i) => {
                          const wave = stat.waves.find((w) => w.wave === i + 1);
                          return (
                            <td key={i} className="p-4 text-center">
                              {wave && wave.score > 0 ? (
                                <div className="group relative cursor-help inline-block">
                                  <span className="text-base font-bebas tracking-widest text-primary-900">
                                    {wave.score.toFixed(2)}
                                  </span>
                                  {/* Tooltip notes juges - Simplified style */}
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:flex flex-col items-center bg-primary-900 text-white text-[10px] p-2 rounded-xl z-50 shadow-block min-w-max border-2 border-primary-950">
                                    <div className="flex gap-4">
                                      {config.judges.map((jId, idx) => {
                                        const s = wave.judgeScores[jId];
                                        if (s === undefined) return null;
                                        return (
                                          <div key={jId} className="flex flex-col items-center">
                                            <span className="text-[8px] text-primary-300 uppercase leading-none mb-1">
                                              {config.judgeNames[jId] || `J${idx + 1}`}
                                            </span>
                                            <span className="font-bebas text-lg leading-none">
                                              {s.toFixed(1)}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="w-2 h-2 bg-primary-900 rotate-45 absolute -bottom-1 border-r-2 border-b-2 border-primary-950 shadow-block" />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-primary-100">—</span>
                              )}
                            </td>
                          );
                        })}

                        <td className="p-4 text-center bg-cta-50">
                          <span className="text-2xl font-bebas tracking-widest text-cta-600">
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

      {/* HEAT TERMINÉ */}
      {heatStatus === 'finished' && (
        <div className="bg-white border-4 border-primary-950 rounded-2xl p-6 shadow-block">
          <HeatResults
            heatId={`${config.competition}-${config.division}-${config.round}-${config.heatId}`}
            competition={config.competition}
            division={config.division}
            round={config.round}
            heatNumber={config.heatId}
            surfers={config.surfers}
            judgeIds={config.judges}
            judgeNames={config.judgeNames}
            maxWaves={config.waves}
            scores={scores}
            visible={true}
          />
        </div>
      )}
    </div>
  );
}

export { ScoreDisplay };
