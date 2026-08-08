import { describe, expect, it, vi } from 'vitest';
import type { Score } from '../../../types';
import { calculateShadowHeatResult } from '../shadow';

const score = (judge: string, value: number, id = judge, timestamp = '2026-03-23T10:00:00.000Z'): Score => ({
  id, heat_id: 'shadow-heat', competition: 'Test', division: 'OPEN', round: 1,
  judge_id: judge, judge_name: judge, judge_station: judge, surfer: 'ROUGE', wave_number: 1,
  score: value, timestamp, created_at: timestamp,
});

const input = (scores: Score[], judgeCount = 3) => ({
  heatId: 'shadow-heat', scores, surfers: ['ROUGE'], judgeCount,
  judgeStations: Array.from({ length: judgeCount }, (_, index) => `J${index + 1}`), maxWaves: 4,
});

describe('P2 shadow migration guard', () => {
  it('selects the canonical snapshot only after strict legacy parity', () => {
    const result = calculateShadowHeatResult(input([score('J1', 6), score('J2', 7), score('J3', 8)]));
    expect(result).toMatchObject({ parity: true, source: 'p2', issue: null });
    expect(result.stats[0].bestTwo).toBe(7);
    expect(result.snapshot?.competitors[0].total).toBe(7);
  });

  it('logs a divergence and keeps the legacy result when an exact timestamp exposes the new deterministic id tie-break', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = calculateShadowHeatResult(input([
      score('J1', 5, 'a'), score('J1', 9, 'z'), score('J2', 7), score('J3', 7),
    ]));
    expect(result).toMatchObject({ parity: false, source: 'none', issue: 'shadow_divergence' });
    expect(result.stats[0].waves[0].judgeScores.J1).toBe(5);
    expect(error).toHaveBeenCalledWith('[P2 shadow divergence]', expect.any(Object));
    error.mockRestore();
  });

  it('does not display a score rejected by the official 0.1 policy', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = calculateShadowHeatResult(input([score('J1', 0), score('J2', 7), score('J3', 8)]));
    expect(result).toMatchObject({ parity: false, source: 'none', issue: 'invalid_official_score', stats: [] });
    error.mockRestore();
  });

  it('returns an explicit state without invoking a silent legacy calculation for panels other than 3/5', () => {
    const result = calculateShadowHeatResult(input([score('J1', 7)], 4));
    expect(result).toMatchObject({ parity: false, source: 'none', issue: 'unsupported_panel', stats: [], legacyStats: [] });
  });
});
