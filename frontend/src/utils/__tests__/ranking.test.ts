import { describe, expect, it } from 'vitest';
import { selectDivisionFinalists, type FinalRankEntry } from '../ranking';

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
