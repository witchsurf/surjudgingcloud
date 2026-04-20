import { describe, expect, it } from 'vitest';
import { parseActiveHeatId } from '../heats.api';

describe('parseActiveHeatId', () => {
  it('keeps ONDINE OPEN as a compound division instead of reducing it to OPEN', () => {
    expect(parseActiveHeatId('ligue_pro_1_ondine_open_r2_h1')).toEqual({
      competition: 'LIGUE PRO 1',
      division: 'ONDINE OPEN',
      round: 2,
      heatNumber: 1,
    });
  });

  it('still parses the plain OPEN division', () => {
    expect(parseActiveHeatId('ligue_pro_1_open_r4_h1')).toEqual({
      competition: 'LIGUE PRO 1',
      division: 'OPEN',
      round: 4,
      heatNumber: 1,
    });
  });
});
