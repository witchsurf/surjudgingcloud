import { describe, expect, it } from 'vitest';
import { calculateSurferStats } from '../scoring';
import type { EffectiveInterference, Score } from '../../types';

const buildScores = (): Score[] => [
  {
    heat_id: 'heat-1',
    competition: 'Test Event',
    division: 'OPEN',
    round: 1,
    judge_id: 'J1',
    judge_name: 'Judge 1',
    surfer: 'ROUGE',
    wave_number: 1,
    score: 4,
    timestamp: '2026-03-23T10:00:00Z',
  },
  {
    heat_id: 'heat-1',
    competition: 'Test Event',
    division: 'OPEN',
    round: 1,
    judge_id: 'J1',
    judge_name: 'Judge 1',
    surfer: 'ROUGE',
    wave_number: 2,
    score: 2,
    timestamp: '2026-03-23T10:01:00Z',
  },
];

describe('calculateSurferStats', () => {
  it('shows the second scoring wave as zero for an INT2 interference', () => {
    const effectiveInterferences: EffectiveInterference[] = [
      {
        surfer: 'ROUGE',
        waveNumber: 2,
        type: 'INT2',
        source: 'majority',
      },
    ];

    const stats = calculateSurferStats(
      buildScores(),
      ['ROUGE'],
      1,
      4,
      false,
      effectiveInterferences
    );

    expect(stats[0].bestTwo).toBe(4);
    expect(stats[0].waves.find((wave) => wave.wave === 1)?.score).toBe(4);
    expect(stats[0].waves.find((wave) => wave.wave === 2)?.score).toBe(0);
  });
});
