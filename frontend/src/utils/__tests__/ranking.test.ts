import { describe, expect, it } from 'vitest';
import type { HeatRow } from '../../api/modules/heats.api';
import type { HeatResultSnapshot } from '../../domain/scoring/contracts';
import { calculateFinalRankings, selectDivisionFinalists, type FinalRankEntry } from '../ranking';

const entry = (rank: number, exitRound: number, name: string): FinalRankEntry => ({
  rank,
  name,
  points: 0,
  exitRound,
  exitPosition: rank,
  qualifiers: 2,
  heatTotal: 10,
  bestWave: 6,
  division: 'OPEN',
});

describe('selectDivisionFinalists', () => {
  it('keeps only surfers from the last round and orders them by final rank', () => {
    const finalists = selectDivisionFinalists([
      entry(5, 2, 'Semi-finaliste'),
      entry(2, 3, 'Finaliste 2'),
      entry(1, 3, 'Finaliste 1'),
      entry(6, 2, 'Semi-finaliste 2'),
    ]);

    expect(finalists.map(({ rank, name }) => ({ rank, name }))).toEqual([
      { rank: 1, name: 'Finaliste 1' },
      { rank: 2, name: 'Finaliste 2' },
    ]);
  });
});

const finalHeat: HeatRow = {
  id: 'final-heat', event_id: 1, competition: 'P2', division: 'OPEN', round: 1,
  heat_number: 1, heat_size: 2, status: 'closed', color_order: ['ROUGE', 'BLANC'],
  slots: [
    { color: 'ROUGE', name: 'Alice', country: 'SN' },
    { color: 'BLANC', name: 'Bob', country: 'FR' },
  ],
};

const finalSnapshot: HeatResultSnapshot = {
  heatId: finalHeat.id,
  panel: { size: 3, stations: ['J1', 'J2', 'J3'] },
  calculatedAt: '2026-08-05T10:00:00.000Z',
  competitors: [
    {
      lycraColor: 'ROUGE', participant: null, rank: 1, total: 15, bestWaveNumbers: [1, 2],
      waves: [
        { waveNumber: 1, judgeScores: { J1: 8, J2: 8, J3: 8 }, retainedScores: [8, 8, 8], average: 8, complete: true, countsTowardsTotal: true },
        { waveNumber: 2, judgeScores: { J1: 7, J2: 7, J3: 7 }, retainedScores: [7, 7, 7], average: 7, complete: true, countsTowardsTotal: true },
      ],
      disqualified: false, interferenceCount: 0, interferenceType: null, interferenceWaves: [],
    },
    {
      lycraColor: 'BLANC', participant: null, rank: 2, total: 12, bestWaveNumbers: [1, 2],
      waves: [
        { waveNumber: 1, judgeScores: { J1: 6, J2: 6, J3: 6 }, retainedScores: [6, 6, 6], average: 6, complete: true, countsTowardsTotal: true },
        { waveNumber: 2, judgeScores: { J1: 6, J2: 6, J3: 6 }, retainedScores: [6, 6, 6], average: 6, complete: true, countsTowardsTotal: true },
      ],
      disqualified: false, interferenceCount: 0, interferenceType: null, interferenceWaves: [],
    },
  ],
};

describe('P2.4 canonical heat results in final rankings', () => {
  it('uses canonical heat rank, total and best wave while preserving championship points', () => {
    const results = calculateFinalRankings('OPEN', [finalHeat], new Map([[finalHeat.id, finalSnapshot]]), []);
    expect(results.map(({ name, rank, heatTotal, bestWave, points }) => ({ name, rank, heatTotal, bestWave, points }))).toEqual([
      { name: 'Alice', rank: 1, heatTotal: 15, bestWave: 8, points: 1000 },
      { name: 'Bob', rank: 2, heatTotal: 12, bestWave: 6, points: 700 },
    ]);
  });

  it('does not classify a heat when its canonical snapshot is unavailable', () => {
    expect(calculateFinalRankings('OPEN', [finalHeat], new Map(), [])).toEqual([]);
  });
});
