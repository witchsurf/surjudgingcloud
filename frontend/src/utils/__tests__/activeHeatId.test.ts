import { describe, expect, it } from 'vitest';
import { parseActiveHeatId } from '../activeHeatId';

describe('parseActiveHeatId pure utility', () => {
  it('preserves compound and simple divisions', () => {
    expect(parseActiveHeatId('ligue_pro_1_ondine_open_r2_h1')).toEqual({
      competition: 'LIGUE PRO 1', division: 'ONDINE OPEN', round: 2, heatNumber: 1,
    });
    expect(parseActiveHeatId('ligue_pro_1_open_r4_h1')).toEqual({
      competition: 'LIGUE PRO 1', division: 'OPEN', round: 4, heatNumber: 1,
    });
  });

  it('returns null for an invalid heat id', () => {
    expect(parseActiveHeatId('not-a-heat')).toBeNull();
    expect(parseActiveHeatId('')).toBeNull();
  });
});
