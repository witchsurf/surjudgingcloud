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
    <div className="bg-white border-4 border-primary-950 rounded-2xl overflow-hidden shadow-block font-sans">
      <div className="bg-primary-900 px-6 py-6 text-center border-b-4 border-primary-950 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-cta-500/10 rounded-full -mr-12 -mt-12 blur-2xl" />
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-300 relative z-10">{title}</p>
        <h3 className="mt-2 text-2xl font-bebas tracking-widest text-white relative z-10">RÉSULTATS OFFICIELS</h3>
        {entriesError && (
          <p className="mt-2 text-xs font-bold text-red-400 uppercase tracking-widest">
            {entriesError}
          </p>
        )}
        {loadingEntries && !entriesError && (
          <p className="mt-2 text-[10px] font-bold text-primary-400 uppercase tracking-widest animate-pulse">Chargement des athlètes...</p>
        )}
      </div>

      <div className="p-4 sm:p-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-primary-50 border-b-2 border-primary-100 uppercase tracking-widest">
              <tr>
                <th className="px-4 py-4 text-left font-bebas text-lg text-primary-900">SURFEUR</th>
                <th className="px-4 py-4 text-center font-bebas text-lg text-primary-900">BIB</th>
                <th className="px-4 py-4 text-center font-bebas text-lg bg-cta-50 text-cta-600">TOTAL</th>
                {Array.from({ length: Math.max(...rows.map((row) => row.waves.length), 0) }, (_, i) => i + 1).map((waveNumber) => (
                  <th key={`wave-${waveNumber}`} className="px-3 py-4 text-center font-bebas text-lg text-primary-300">
                    V{waveNumber}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-primary-50">
              {rows.map((row, idx) => (
                <tr
                  key={row.key}
                  className="hover:bg-primary-50/20 transition-colors"
                >
                  <td className="px-4 py-4">
                    <div className="font-bebas text-xl text-primary-900 leading-none">{row.name}</div>
                    {row.country && (
                      <div className="text-[9px] font-bold uppercase tracking-widest text-primary-400 mt-1">{row.country}</div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="inline-flex min-w-[32px] justify-center rounded-lg border-2 border-primary-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary-900 bg-white shadow-sm">
                      {row.jersey}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center bg-cta-50">
                    <span className="text-3xl font-bebas text-cta-600 leading-none">
                      {row.total.toFixed(2)}
                    </span>
                  </td>
                  {Array.from({ length: Math.max(...rows.map((r) => r.waves.length), 0) }, (_, i) => i + 1).map((waveNumber) => {
                    const wave = row.waves.find((w) => w.wave === waveNumber);
                    return (
                      <td key={`${row.key}-wave-${waveNumber}`} className="px-3 py-4 text-center">
                        {wave && wave.score > 0 ? (
                          <div className="relative group inline-flex justify-center cursor-help">
                            <span className={`inline-flex min-w-[50px] justify-center rounded-lg border-2 px-2 py-1 font-bebas text-lg transition-transform group-hover:scale-110 ${
                              wave.isComplete 
                                ? 'bg-primary-50 border-primary-200 text-primary-800' 
                                : 'bg-cta-50 border-cta-200 text-cta-600'
                            }`}>
                              {wave.score.toFixed(2)}
                              {!wave.isComplete && <span className="ml-0.5 text-xs text-cta-400">*</span>}
                            </span>
                            
                            {/* Detailed Popover */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:block bg-primary-900 text-white p-3 rounded-xl border-2 border-primary-950 shadow-block z-50 min-w-max">
                              <div className="flex gap-4">
                                {Object.entries(wave.judgeScores)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([judgeId, value]) => (
                                    <div key={judgeId} className="flex flex-col items-center">
                                      <span className="text-[8px] font-bold text-primary-300 uppercase tracking-widest mb-1">
                                        {judgeNames[judgeId] || judgeId}
                                      </span>
                                      <span className="text-lg font-bebas leading-none">
                                        {value.toFixed(1)}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                              <div className="w-2 h-2 bg-primary-900 border-r-2 border-b-2 border-primary-950 absolute -bottom-1 left-1/2 -translate-x-1/2 rotate-45" />
                            </div>
                          </div>
                        ) : (
                          <span className="text-primary-100">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="text-primary-200 font-bebas text-2xl tracking-widest opacity-40">AUCUN SCORE ENREGISTRÉ</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
