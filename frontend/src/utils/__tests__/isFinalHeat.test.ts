import { describe, it, expect } from 'vitest';
import { isFinalHeat } from '../heat';

describe('isFinalHeat authoritative final detection', () => {
  it('identifies final when round equals totalRounds', () => {
    expect(isFinalHeat({ round: 3, totalRounds: 3 })).toBe(true);
    expect(isFinalHeat({ round: 2, totalRounds: 3 })).toBe(false);
    expect(isFinalHeat({ round: 1, totalRounds: 3 })).toBe(false);
  });

  it('identifies direct 1-round final', () => {
    expect(isFinalHeat({ round: 1, totalRounds: 1 })).toBe(true);
  });

  it('identifies final from division heats planning sequence without totalRounds', () => {
    const heats = [
      { division: 'Open', round: 1, heat_number: 1 },
      { division: 'Open', round: 1, heat_number: 2 },
      { division: 'Open', round: 2, heat_number: 1 },
      { division: 'Junior', round: 1, heat_number: 1 },
    ];
    expect(isFinalHeat({ round: 2, division: 'Open', heats })).toBe(true);
    expect(isFinalHeat({ round: 1, division: 'Open', heats })).toBe(false);
    expect(isFinalHeat({ round: 1, division: 'Junior', heats })).toBe(true);
  });

  it('uses the division planning before a stale legacy totalRounds value', () => {
    const heats = [
      { division: 'Cadet', round: 1, heat_number: 1 },
      { division: 'Cadet', round: 2, heat_number: 1 },
    ];

    expect(isFinalHeat({ round: 1, totalRounds: 1, division: 'Cadet', heats })).toBe(false);
    expect(isFinalHeat({ round: 2, totalRounds: 1, division: 'Cadet', heats })).toBe(true);
  });

  it('identifies final from roundName or heat metadata', () => {
    expect(isFinalHeat({ round: 1, roundName: 'Grande Finale' })).toBe(true);
    expect(isFinalHeat({ round: 2, heatMetadata: { round_name: 'Final' } })).toBe(true);
    expect(isFinalHeat({ round: 1, roundName: 'Round 1' })).toBe(false);
  });

  it('returns false when no metadata indicates a final', () => {
    expect(isFinalHeat({ round: 1 })).toBe(false);
  });
});
