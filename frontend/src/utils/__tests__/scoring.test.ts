import { describe, expect, it } from 'vitest';
import { calculateNeededWaveScore, calculateSurferStats, calculateSurfRequirement } from '../scoring';
import type { EffectiveInterference, Score, SurferStats } from '../../types';

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

  it('shows the second best wave at 50% for an INT1 interference', () => {
    const effectiveInterferences: EffectiveInterference[] = [
      {
        surfer: 'BLANC',
        waveNumber: 2,
        type: 'INT1',
        source: 'majority',
      },
    ];
    const scores: Score[] = [
      ...buildScores().map((score) => ({ ...score, surfer: 'WHITE', score: score.wave_number === 1 ? 8 : 6 })),
    ];

    const stats = calculateSurferStats(scores, ['WHITE'], 1, 4, false, effectiveInterferences);

    expect(stats[0].bestTwo).toBe(11);
    expect(stats[0].interferenceWaves).toEqual([{ waveNumber: 2, type: 'INT1' }]);
    expect(stats[0].waves.find((wave) => wave.wave === 1)?.score).toBe(8);
    expect(stats[0].waves.find((wave) => wave.wave === 2)?.score).toBe(3);
    expect(stats[0].waves.find((wave) => wave.wave === 2)?.judgeScores).toEqual({ J1: 6 });
  });

  it('keeps an incomplete wave excluded after the heat is closed', () => {
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

    // Closing the heat must not turn a 2/3 wave into an official result.
    const closedStats = calculateSurferStats(scores, ['ROUGE'], 3, 4, false, [], 'closed');
    expect(closedStats[0].bestTwo).toBe(0);
    expect(closedStats[0].waves[0].isComplete).toBe(false);
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

describe('calculateNeededWaveScore', () => {
  const buildStats = (interferenceType: 'INT1' | 'INT2' | null): SurferStats => ({
    surfer: 'WHITE',
    waves: [
      { wave: 1, score: 7.95, judgeScores: { J1: 7.9, J2: 8, J3: 7.95 }, isComplete: true },
      { wave: 2, score: interferenceType === 'INT1' ? 3.88 : 7.75, judgeScores: { J1: 7.7, J2: 7.8, J3: 7.75 }, isComplete: true },
    ],
    bestTwo: interferenceType === 'INT1' ? 11.83 : 15.7,
    rank: 2,
    color: '#fff',
    interferenceType,
  });

  it('raises the requirement when INT1 will halve the second best wave', () => {
    expect(calculateNeededWaveScore(buildStats('INT1'), 12.9)).toBe(8.94);
  });

  it('keeps the standard requirement without interference', () => {
    expect(calculateNeededWaveScore(buildStats(null), 12.9)).toBe(4.96);
  });

  it('requires a new best wave to beat the target with INT2', () => {
    expect(calculateNeededWaveScore(buildStats('INT2'), 9)).toBe(9.01);
  });

  it('returns a combo when no single wave can reach the leader', () => {
    const stats = buildStats(null);
    stats.waves = [
      { wave: 1, score: 6.55, judgeScores: { J1: 6.5, J2: 6.6, J3: 6.55 }, isComplete: true },
      { wave: 2, score: 6.35, judgeScores: { J1: 6.3, J2: 6.4, J3: 6.35 }, isComplete: true },
    ];
    stats.bestTwo = 12.9;

    expect(calculateNeededWaveScore(stats, 18.43)).toBe(11.89);
    expect(calculateSurfRequirement(stats, 18.43)).toEqual({
      value: 18.44,
      isCombo: true,
    });
  });
});
