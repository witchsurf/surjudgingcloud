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

  it('is resilient when heat is closed or finished', () => {
    const scores: Score[] = [
      {
        heat_id: 'heat-1',
        competition: 'Test Event',
        division: 'OPEN',
        round: 1,
        judge_id: 'J1',
        judge_name: 'Judge 1',
        surfer: 'ROUGE',
        wave_number: 1,
        score: 6,
        timestamp: '2026-03-23T10:00:00Z',
      },
      {
        heat_id: 'heat-1',
        competition: 'Test Event',
        division: 'OPEN',
        round: 1,
        judge_id: 'J2',
        judge_name: 'Judge 2',
        surfer: 'ROUGE',
        wave_number: 1,
        score: 8,
        timestamp: '2026-03-23T10:00:00Z',
      }
    ];

    // Case 1: Strict mode (Status waiting/running) - Need 3 judges but only 2 present
    const strictStats = calculateSurferStats(scores, ['ROUGE'], 3, 4, false, [], 'running');
    expect(strictStats[0].bestTwo).toBe(0); // wave 1 incomplete

    // Case 2: Resilient mode (Status closed/finished) - 2/3 is okay
    const resilientStats = calculateSurferStats(scores, ['ROUGE'], 3, 4, false, [], 'closed');
    expect(resilientStats[0].bestTwo).toBe(7); // avg(6, 8) = 7
  });

  it('deduplicates scores using timestamp (last-write-wins)', () => {
    const scores: Score[] = [
      {
        heat_id: 'heat-1',
        competition: 'Test Event',
        division: 'OPEN',
        round: 1,
        judge_id: 'J1',
        judge_name: 'Judge 1',
        surfer: 'ROUGE',
        wave_number: 1,
        score: 5,
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
        wave_number: 1,
        score: 9, // correction: newest
        timestamp: '2026-03-23T10:01:00Z',
      }
    ];

    const stats = calculateSurferStats(scores, ['ROUGE'], 1, 4, false, [], 'closed');
    expect(stats[0].bestTwo).toBe(9); // correct overridden score
  });
});
