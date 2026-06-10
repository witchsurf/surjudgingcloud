import { useEffect, useMemo, useState } from 'react';
import { calculateSurferStats } from '../utils/scoring';
import { SURFER_COLORS } from '../utils/constants';
import type { AppConfig, HeatTimer, Score, SurferStats } from '../types';

interface ObsOverlayProps {
  config: AppConfig;
  scores: Score[];
  timer: HeatTimer;
  heatStatus?: 'waiting' | 'running' | 'paused' | 'finished';
}

type OverlayRow = SurferStats & {
  latestWave?: number;
  needsScore: number | null;
  bestScores: string[];
};

const COLOR_LABELS: Record<string, string> = {
  ROUGE: 'R',
  BLANC: 'W',
  JAUNE: 'Y',
  BLEU: 'B',
  VERT: 'G',
  NOIR: 'N',
};

const formatTimer = (seconds: number): string => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const getRemainingSeconds = (timer: HeatTimer): number => {
  if (timer.isRunning && timer.startTime) {
    const startTime =
      timer.startTime instanceof Date ? timer.startTime : new Date(timer.startTime);

    const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
    return Math.max(0, timer.duration * 60 - elapsed);
  }

  return timer.duration * 60;
};

const getTextColorForJersey = (surfer: string): string => {
  const normalized = surfer.trim().toUpperCase();
  return normalized === 'BLANC' || normalized === 'JAUNE' ? '#07111f' : '#ffffff';
};

const getNeedsScore = (stat: SurferStats, standings: SurferStats[]): number | null => {
  if (stat.rank <= 2) return null;

  const secondPlace = standings.find((item) => item.rank === 2);
  if (!secondPlace) return null;

  const bestCurrentWave = stat.waves
    .filter((wave) => wave.isComplete)
    .reduce((best, wave) => Math.max(best, wave.score), 0);

  const needed = secondPlace.bestTwo - bestCurrentWave + 0.01;
  return needed > 0 ? Math.round(needed * 100) / 100 : 0.01;
};

export default function ObsOverlay({
  config,
  scores,
  timer,
  heatStatus = 'waiting',
}: ObsOverlayProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => getRemainingSeconds(timer));
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    const tick = () => setRemainingSeconds(getRemainingSeconds(timer));
    tick();

    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [timer]);

  useEffect(() => {
    setLastUpdate(new Date());
  }, [scores, timer, config]);

  const standings = useMemo(
    () => calculateSurferStats(scores, config.surfers, config.judges.length, config.waves),
    [config.judges.length, config.surfers, config.waves, scores]
  );

  const rows: OverlayRow[] = useMemo(
    () =>
      standings.map((stat) => ({
        ...stat,
        latestWave: stat.waves.filter((wave) => wave.score > 0).slice(-1)[0]?.wave,
        needsScore: getNeedsScore(stat, standings),
        bestScores: [...stat.waves]
          .filter((wave) => wave.isComplete)
          .sort((a, b) => b.score - a.score)
          .slice(0, 2)
          .map((wave) => wave.score.toFixed(2)),
      })),
    [standings]
  );

  if (!config.competition) {
    return (
      <main className="min-h-screen bg-transparent p-8 text-white">
        <div className="inline-flex rounded-xl bg-slate-950/85 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] shadow-2xl ring-1 ring-white/15">
          OBS Overlay · Waiting for heat configuration
        </div>
      </main>
    );
  }

  const statusLabel = heatStatus === 'running' ? 'LIVE' : heatStatus.toUpperCase();

  return (
    <main className="obs-overlay min-h-screen bg-transparent p-6 font-sans text-white">
      <section className="w-[640px] max-w-[52vw] overflow-hidden rounded-sm bg-slate-950/88 shadow-2xl ring-1 ring-white/15 backdrop-blur-[2px]">
        <header className="grid grid-cols-[88px_1fr_112px] items-stretch bg-slate-950/95 text-white">
          <div className="flex items-center justify-center bg-white px-3 py-2 text-base font-black tracking-tight text-slate-950">
            SURF
          </div>

          <div className="flex items-center justify-between px-4 py-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">
                {config.competition}
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-300">
                {config.division} · R{config.round} H{config.heatId}
              </div>
            </div>

            <div className="rounded bg-red-600 px-2 py-1 text-[10px] font-black tracking-[0.22em]">
              {statusLabel}
            </div>
          </div>

          <div className="flex items-center justify-center bg-slate-800 px-3 py-2 font-mono text-2xl font-black tabular-nums">
            {formatTimer(remainingSeconds)}
          </div>
        </header>

        <div className="grid grid-cols-[44px_1fr_82px_122px_94px] bg-slate-800/95 text-[10px] font-black uppercase tracking-[0.14em] text-slate-300">
          <div className="py-2 text-center">P</div>
          <div className="py-2">Surfer</div>
          <div className="py-2 text-center">Total</div>
          <div className="py-2 text-center">Best 2</div>
          <div className="py-2 text-center">Needs</div>
        </div>

        <div>
          {rows.map((row) => {
            const jersey = row.surfer.trim().toUpperCase();
            const jerseyColor = SURFER_COLORS[jersey] ?? row.color;
            const textColor = getTextColorForJersey(jersey);

            return (
              <div
                key={row.surfer}
                className="grid grid-cols-[44px_1fr_82px_122px_94px] items-center border-t border-white/10 bg-slate-900/90 text-sm"
              >
                <div className="flex h-full items-center justify-center border-r border-white/10 text-lg font-black">
                  {row.rank}
                </div>

                <div className="flex min-w-0 items-center gap-3 py-2 pr-2">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center font-black shadow-inner ring-1 ring-white/40"
                    style={{ backgroundColor: jerseyColor, color: textColor }}
                  >
                    {COLOR_LABELS[jersey] ?? jersey.slice(0, 1)}
                  </span>

                  <div className="min-w-0">
                    <div className="truncate text-base font-black uppercase leading-5">
                      {row.surfer}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {row.latestWave ? `Wave ${row.latestWave}` : 'Awaiting score'}
                    </div>
                  </div>
                </div>

                <div className="px-2 text-center font-mono text-lg font-black tabular-nums">
                  {row.bestTwo.toFixed(2)}
                </div>

                <div className="flex justify-center gap-2 px-2 font-mono text-sm font-bold tabular-nums text-slate-200">
                  <span>{row.bestScores[0] ?? '--'}</span>
                  <span>{row.bestScores[1] ?? '--'}</span>
                </div>

                <div className="px-2 text-center font-mono text-sm font-black tabular-nums text-cyan-200">
                  {row.needsScore === null ? '--' : row.needsScore.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex items-center justify-between bg-slate-950/95 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          <span>Best two waves count</span>
          <span>Updated {lastUpdate.toLocaleTimeString('fr-FR')}</span>
        </footer>
      </section>
    </main>
  );
}
