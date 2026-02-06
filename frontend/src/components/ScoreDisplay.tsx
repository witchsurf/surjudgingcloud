import { useState, useEffect } from 'react';
import { Users, Trophy, FileText } from 'lucide-react';
import HeatTimer from './HeatTimer';
import HeatResults from './HeatResults';
import { calculateSurferStats } from '../utils/scoring';
import { exportHeatScorecardPdf } from '../utils/pdfExport';

import type {
  AppConfig,
  Score,
  SurferStats,
  HeatTimer as HeatTimerType,
} from '../types';

interface ScoreDisplayProps {
  config: AppConfig;
  scores: Score[];
  timer: HeatTimerType;
  configSaved: boolean;
  heatStatus?: 'waiting' | 'running' | 'paused' | 'finished';
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

  // Calcul des stats
  useEffect(() => {
    if (!configSaved) return;
    if (!config || !config.surfers) return;

    const judgeCount = config.judges.length;
    const stats = calculateSurferStats(
      scores,
      config.surfers,
      judgeCount,
      config.waves,
      heatStatus === 'finished' // allowIncomplete if heat is finished
    );
    setSurferStats(stats);
  }, [scores, configSaved, config]);

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
    <div className="score-display max-w-6xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl p-4 sm:p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">
              {config.competition}
            </h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-blue-100">
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {config.division}
              </span>
              <span>Round {config.round}</span>
              <span>Heat {config.heatId}</span>
            </div>
          </div>

          <div className="text-left sm:text-right text-xs sm:text-sm">
            <div className="text-blue-100">Dernière mise à jour</div>
            <div className="font-mono text-sm sm:text-base">
              {lastUpdate.toLocaleTimeString('fr-FR')}
            </div>

            <button
              type="button"
              onClick={() => exportHeatScorecardPdf({ config, scores, eventData })}
              className="mt-2 inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 border border-white/60 rounded-full text-xs sm:text-sm font-semibold hover:bg-white/10 w-full sm:w-auto"
            >
              <FileText className="w-4 h-4" />
              Exporter le Heat (PDF)
            </button>
          </div>
        </div>
      </div>

      {/* TIMER */}
      <div className="flex justify-center">
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

      {/* CLASSEMENT */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-4 sm:px-6 py-3 sm:py-4 border-b">
          <h2 className="text-lg sm:text-xl font-bold flex items-center">
            <Trophy className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-yellow-500" />
            Classement en temps réel
          </h2>
        </div>

        {!hasScores && (
          <div className="p-4 sm:p-6 text-sm sm:text-base text-gray-500">
            Aucun score pour le moment…
          </div>
        )}

        {hasScores && !hasStats && (
          <div className="p-4 sm:p-6 text-sm sm:text-base text-gray-500">
            En attente de suffisamment de notes pour établir un classement…
          </div>
        )}

        {hasStats && (
          <div className="divide-y">
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
                    className={`p-4 sm:p-6 ${style.bg} ${style.text}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
                      {/* Bloc gauche: couleur + nom + infos */}
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-black/20 rounded-full text-base sm:text-lg font-bold">
                          {stat.rank ?? '-'}
                        </div>

                        <div className="flex items-center gap-3">
                          <div
                            className={`w-6 h-6 rounded-full border-2 border-white ${style.badge}`}
                          />
                          <div className="space-y-0.5 sm:space-y-1">
                            <div className="text-base sm:text-xl font-bold leading-tight">
                              {displayName}
                            </div>
                            {country && (
                              <div className="text-[0.65rem] sm:text-xs opacity-80 uppercase tracking-wide">
                                {country}
                              </div>
                            )}
                            <div className="text-[0.65rem] sm:text-xs opacity-70">
                              Lycra: {stat.surfer} • {wavesCount} vague
                              {wavesCount > 1 ? 's' : ''} complétée
                              {wavesCount > 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bloc droit: score total + WIN BY + NEED */}
                      <div className="text-right space-y-0.5 sm:space-y-1">
                        <div className="text-2xl sm:text-3xl font-bold leading-tight">
                          {(stat.bestTwo ?? 0).toFixed(2)}
                        </div>
                        <div className="text-[0.7rem] sm:text-xs opacity-80">
                          Total des 2 meilleures vagues
                        </div>
                        {stat.rank === 1 && winBy != null && (
                          <div className="text-[0.7rem] sm:text-xs font-semibold">
                            WIN BY {winBy.toFixed(2)}
                          </div>
                        )}
                        {neededInfo && (
                          <div className="text-[0.7rem] sm:text-xs font-semibold">
                            NEED {neededInfo.needed.toFixed(2)}{' '}
                            pour{' '}
                            {neededInfo.targetRank === 1
                              ? 'passer 1er'
                              : 'se qualifier'}
                          </div>
                        )}
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
        <div className="overflow-x-auto border rounded-xl bg-white shadow-sm">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 text-left font-semibold">Surfeur</th>
                {Array.from({ length: maxWaves }).map((_, i) => (
                  <th
                    key={i}
                    className="p-2 sm:p-3 text-center font-semibold"
                  >
                    V{i + 1}
                  </th>
                ))}
                <th className="p-2 sm:p-3 text-center font-semibold bg-green-50">
                  Best 2
                </th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {surferStats
                .slice()
                .sort(sortStats)
                .map((stat, idx) => {
                  const displayName = surferNames?.[stat.surfer] ?? stat.surfer;
                  const country = surferCountries?.[stat.surfer];

                  return (
                    <tr
                      key={stat.surfer}
                      className={idx % 2 ? 'bg-gray-50' : 'bg-white'}
                    >
                      <td className="p-2 sm:p-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs sm:text-sm">
                            {displayName}
                          </span>
                          <span className="text-[0.65rem] sm:text-xs text-gray-500">
                            Lycra: {stat.surfer}
                            {country ? ` • ${country}` : ''}
                          </span>
                        </div>
                      </td>

                      {Array.from({ length: maxWaves }).map((_, i) => {
                        const wave = stat.waves.find((w) => w.wave === i + 1);
                        return (
                          <td key={i} className="p-2 sm:p-3 text-center">
                            {wave && wave.score > 0 ? (
                              <div className="group relative cursor-help inline-block">
                                <span className="font-semibold">
                                  {wave.score.toFixed(2)}
                                </span>
                                {/* Tooltip notes juges */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center bg-gray-900 text-white text-xs p-2 rounded z-50 shadow-lg min-w-max">
                                  <div className="flex gap-3">
                                    {config.judges.map((jId, idx) => {
                                      const s = wave.judgeScores[jId];
                                      if (s === undefined) return null;
                                      return (
                                        <div key={jId} className="flex flex-col items-center">
                                          <span className="text-[0.6rem] text-gray-400 uppercase tracking-wider font-semibold">
                                            {config.judgeNames[jId] || `J${idx + 1}`}
                                          </span>
                                          <span className="font-mono font-bold text-sm">
                                            {s.toFixed(1)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {/* Flèche du tooltip */}
                                  <div className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1"></div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        );
                      })}

                      <td className="p-2 sm:p-3 text-center font-bold bg-green-50">
                        {(stat.bestTwo ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* HEAT TERMINÉ */}
      {heatStatus === 'finished' && (
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
      )}
    </div>
  );
}

export { ScoreDisplay };
