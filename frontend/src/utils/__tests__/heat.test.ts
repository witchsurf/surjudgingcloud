import { describe, expect, it } from 'vitest';
import { getHeatRoundLabel, getHeatSeriesLabel } from '../heat';

describe('heat display labels', () => {
  it('renders the last round as Finale when a tournament has multiple rounds', () => {
    expect(getHeatRoundLabel(3, 3)).toBe('Finale');
    expect(getHeatSeriesLabel(3, 1, 3)).toBe('Finale');
  });

  it('keeps the technical round/heat label for non-final heats', () => {
    expect(getHeatRoundLabel(2, 3)).toBe('R2');
    expect(getHeatSeriesLabel(2, 4, 3)).toBe('R2 H4');
  });

  it('does not force Finale when the structure has a single round', () => {
    expect(getHeatRoundLabel(1, 1)).toBe('R1');
    expect(getHeatSeriesLabel(1, 1, 1)).toBe('R1 H1');
  });
});
