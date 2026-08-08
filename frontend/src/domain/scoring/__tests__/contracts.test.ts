import { describe, expect, it } from 'vitest';
import { OFFICIAL_SCORING_POLICY, validateOfficialScore } from '../contracts';

describe('official P2 scoring contract', () => {
  it('fixes the approved policy without extending supported panels', () => {
    expect(OFFICIAL_SCORING_POLICY).toMatchObject({
      minScore: 0.1,
      maxScore: 10,
      decimalPlaces: 1,
      waveAverageDecimalPlaces: 2,
      bestWaveCount: 2,
      supportedPanelSizes: [3, 5],
      incompleteWavesCountTowardsTotal: false,
      lastWriteWinsOrder: ['timestamp', 'createdAt', 'id'],
    });
  });

  it.each([
    [0, false],
    [0.1, true],
    [10.0, true],
    [10.1, false],
  ])('validates score %s as %s', (score, valid) => {
    expect(validateOfficialScore(score).valid).toBe(valid);
  });

  it('rejects values with more than one decimal place', () => {
    expect(validateOfficialScore(7.25)).toEqual({ valid: false, reason: 'invalid_precision' });
  });
});
