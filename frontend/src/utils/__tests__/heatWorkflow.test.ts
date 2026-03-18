import { describe, expect, it } from 'vitest';
import { getNextHeatSyncTarget } from '../heatWorkflow';

describe('getNextHeatSyncTarget', () => {
  const baseConfig = {
    competition: 'Test Event',
    division: 'MINIME',
    round: 3,
    heatId: 2,
    judges: [],
    surfers: [],
    waves: 12,
    judgeNames: {},
    surferCountries: {},
    totalSurfers: 0,
    surfersPerHeat: 0,
    totalHeats: 0,
    totalRounds: 0
  };

  it('returns null when there is no next heat', () => {
    expect(getNextHeatSyncTarget(baseConfig, false)).toBeNull();
  });

  it('returns the next heat id when advancing', () => {
    expect(getNextHeatSyncTarget(baseConfig, true)).toBe('test_event_minime_r3_h2');
  });
});
