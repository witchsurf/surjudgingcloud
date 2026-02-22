import { useEffect, useMemo, useState } from 'react';
import type { EffectiveInterference, Score } from '../types';
import { calculateSurferStats, getEffectiveJudgeCount } from '../utils/scoring';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { fetchHeatEntriesWithParticipants, fetchInterferenceCalls } from '../api/supabaseClient';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { HEAT_RESULTS_CACHE_KEY } from '../utils/constants';
import { computeEffectiveInterferences } from '../utils/interference';

interface HeatResultsProps {
  heatId: string | null;
  competition: string;
  division: string;
  round: number;
  heatNumber: number;
  surfers: string[];
  judgeIds: string[];
  judgeNames: Record<string, string>;
  maxWaves: number;
  scores: Score[];
  visible: boolean;
}

type EntryInfo = {
  jersey: string;
  name: string;
  country?: string | null;
};

type HeatResultHistoryEntry = {
  heatKey: string;
  round: number;
  heatNumber: number;
  rank: number;
  color: string;
  total: number;
  name: string;
  country?: string | null;
};

type HeatResultHistory = Record<string, HeatResultHistoryEntry[]>;

export default function HeatResults({
  heatId,
  competition,
  division,
  round,
  heatNumber,
  surfers,
  judgeIds,
  judgeNames,
  maxWaves,
  scores,
  visible,
}: HeatResultsProps) {
  const [entryMap, setEntryMap] = useState<Map<string, EntryInfo>>(new Map());
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [scoresState, setScoresState] = useState<Score[]>(scores);
  const [effectiveInterferences, setEffectiveInterferences] = useState<EffectiveInterference[]>([]);

  useEffect(() => {
    setScoresState(scores);
  }, [scores]);

  useEffect(() => {
    if (!visible || !heatId) return;
    if (!isSupabaseConfigured()) {
      const fallback = new Map<string, EntryInfo>();
      surfers.forEach((label) => {
        fallback.set(label, { jersey: label, name: label });
      });
      setEntryMap(fallback);
      return;
    }

    let cancelled = false;
    const loadEntries = async () => {
      setLoadingEntries(true);
      setEntriesError(null);

      try {
        const entries = await fetchHeatEntriesWithParticipants(heatId);

        const nextMap = new Map<string, EntryInfo>();

        entries.forEach((row) => {
          const rawColor = row.color as HeatColor | null;
          const jerseyLabel = rawColor ? colorLabelMap[rawColor] ?? rawColor : '';
          const key = jerseyLabel || row.participant?.name || '';
          if (!key) return;

          nextMap.set(key, {
            jersey: jerseyLabel || key,
            name: row.participant?.name ?? key,
            country: row.participant?.country ?? null,
          });
        });

        // Fallback for any surfer label missing
        surfers.forEach((label) => {
          if (!nextMap.has(label)) {
            nextMap.set(label, { jersey: label, name: label });
          }
        });

        if (!cancelled) {
          setEntryMap(nextMap);
        }
      } catch (err) {
        console.error('❌ Chargement des heat_entries impossible:', err);
        const message = err instanceof Error ? err.message : 'Impossible de charger les participants du heat.';
        if (!cancelled) {
          setEntriesError(message);
          const fallback = new Map<string, EntryInfo>();
          surfers.forEach((label) => {
            fallback.set(label, { jersey: label, name: label });
          });
          setEntryMap(fallback);
        }
      } finally {
        if (!cancelled) {
          setLoadingEntries(false);
        }
      }
    };

    void loadEntries();

    return () => {
      cancelled = true;
    };
  }, [visible, heatId, surfers]);

  useEffect(() => {
    if (!visible || !heatId || !isSupabaseConfigured()) return;

    let cancelled = false;

    const loadScores = async () => {
      try {
        const { data, error } = await supabase!
          .from('scores')
          .select(
            'id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at'
          )
          .eq('heat_id', heatId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (!cancelled && data) {
          const formatted = data.map((item) => ({
            ...item,
            score: typeof item.score === 'number' ? item.score : parseFloat(String(item.score ?? 0)),
          })) as Score[];
          setScoresState(formatted);
        }
      } catch (err) {
        console.warn('⚠️ Chargement des scores depuis Supabase impossible, utilisation du flux courant.', err);
      }
    };

    void loadScores();

    const channel = isSupabaseConfigured()
      ? supabase!
          .channel(`heat-results-${heatId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'scores', filter: `heat_id=eq.${heatId}` },
            () => {
              void loadScores();
            }
          )
          .subscribe()
      : null;

    return () => {
      cancelled = true;
      channel?.unsubscribe?.();
    };
  }, [visible, heatId]);

  useEffect(() => {
    if (!visible || !heatId || !isSupabaseConfigured()) {
      setEffectiveInterferences([]);
      return;
    }
    let cancelled = false;
    fetchInterferenceCalls(heatId)
      .then((calls) => {
        if (cancelled) return;
        setEffectiveInterferences(computeEffectiveInterferences(calls, Math.max(judgeIds.length, 1)));
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Impossible de charger les interférences du heat', error);
          setEffectiveInterferences([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, heatId, judgeIds.length, scoresState]);

  const rows = useMemo(() => {
    if (!scoresState.length) return [];

    const judgeCount = getEffectiveJudgeCount(scoresState, judgeIds.length);
    const stats = calculateSurferStats(scoresState, surfers, judgeCount, maxWaves, false, effectiveInterferences);
    const aggregates = stats.map((stat) => {
      const entryInfo = entryMap.get(stat.surfer) ?? { jersey: stat.surfer, name: stat.surfer };

      return {
        key: stat.surfer,
        name: entryInfo.name,
        jersey: entryInfo.jersey,
        country: entryInfo.country ?? undefined,
        total: stat.bestTwo,
        waves: stat.waves,
      };
    });

    return aggregates
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.name.localeCompare(b.name);
      })
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }));
  }, [scoresState, surfers, judgeIds.length, maxWaves, entryMap, effectiveInterferences]);

  useEffect(() => {
    if (!visible || !heatId || !rows.length) return;
    if (typeof window === 'undefined') return;

    try {
      let history: HeatResultHistory = {};
      const raw = window.localStorage.getItem(HEAT_RESULTS_CACHE_KEY);
      if (raw) {
        history = JSON.parse(raw) as HeatResultHistory;
      }

      history[heatId] = rows.map((row) => ({
        heatKey: heatId,
        round,
        heatNumber,
        rank: row.rank,
        color: row.jersey.trim().toUpperCase(),
        total: row.total,
        name: row.name,
        country: row.country ?? null,
      }));

      window.localStorage.setItem(HEAT_RESULTS_CACHE_KEY, JSON.stringify(history));
    } catch (error) {
      console.warn('Impossible de sauvegarder les résultats du heat', error);
    }
  }, [visible, heatId, round, heatNumber, rows]);

  if (!visible || !heatId) {
    return null;
  }

  const title = `${competition.toUpperCase()} – ${division.toUpperCase()} | ROUND ${round} • HEAT ${heatNumber}`;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 shadow-2xl shadow-blue-900/20">
      <div className="px-6 py-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</p>
        <h3 className="mt-2 text-lg font-bold uppercase tracking-widest text-white">Résultats du heat</h3>
        {entriesError && (
          <p className="mt-2 text-xs text-red-300">
            {entriesError}
          </p>
        )}
        {loadingEntries && !entriesError && (
          <p className="mt-2 text-xs text-slate-300">Chargement des concurrents…</p>
        )}
      </div>

      <div className="px-4 pb-8 sm:px-6">
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full overflow-hidden rounded-2xl border border-gray-300">
            <table className="min-w-full table-fixed text-sm text-white">
              <thead className="bg-blue-600 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-center font-semibold">Surfeur</th>
                  <th className="px-4 py-3 text-center font-semibold">Couleur</th>
                  <th className="px-4 py-3 text-center font-semibold">Total</th>
                  {Array.from({ length: Math.max(...rows.map((row) => row.waves.length), 0) }, (_, i) => i + 1).map((waveNumber) => (
                    <th key={`wave-${waveNumber}`} className="px-3 py-3 text-center font-semibold">
                      V{waveNumber}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.key}
                    className={idx % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-800/30'}
                  >
                    <td className="px-4 py-3 text-center">
                      <div className="font-semibold text-white">{row.name}</div>
                      {row.country && (
                        <div className="text-xs uppercase tracking-widest text-slate-300">{row.country}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex min-w-[96px] justify-center rounded-full border border-blue-200 px-3 py-1 text-xs font-bold uppercase tracking-widest text-blue-100">
                        {row.jersey}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-xl font-bold text-white">{row.total.toFixed(2)}</td>
                    {Array.from({ length: Math.max(...rows.map((r) => r.waves.length), 0) }, (_, i) => i + 1).map((waveNumber) => {
                      const wave = row.waves.find((w) => w.wave === waveNumber);
                      return (
                        <td key={`${row.key}-wave-${waveNumber}`} className="px-3 py-3 text-center">
                          {wave && wave.score > 0 ? (
                            <div className="relative group inline-flex justify-center">
                              <span className={`inline-flex min-w-[64px] justify-center rounded-md px-2 py-1 text-xs font-semibold ${
                                wave.isComplete ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800 border border-orange-300'
                              }`}>
                                {wave.score.toFixed(2)}
                                {!wave.isComplete && <span className="ml-1 text-[10px]">*</span>}
                              </span>
                              <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 min-w-[140px] -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                {Object.entries(wave.judgeScores)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([judgeId, value], index, arr) => (
                                    <span key={judgeId}>
                                      {judgeNames[judgeId] || judgeId}: {value.toFixed(2)}
                                      {index < arr.length - 1 ? ', ' : ''}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-center text-sm text-slate-400">
                      Aucun score enregistré pour ce heat pour le moment.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
