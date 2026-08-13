import { describe, expect, it } from 'vitest';
import { reconcileRoundHeat } from '../reconcileRoundHeat';

const heats = [
  ['r2h1', 2, 1, 'closed'], ['r2h2', 2, 2, 'closed'], ['r2h3', 2, 3, 'open'],
  ['r3h1', 3, 1, 'open'], ['r3h2', 3, 2, 'open'], ['r4h1', 4, 1, 'open'],
].map(([id, round, heat_number, status]) => ({ id, division: 'OPEN', round: Number(round), heat_number: Number(heat_number), status }));

const base = {
  division: 'OPEN', currentRound: 2, currentHeatId: 3,
  visibleRoundOptions: [2, 3, 4], heats,
  authoritativeStatuses: new Map(heats.map((h) => [h.id, h.status!])),
  activeHeatIds: new Set(['r2h3', 'r3h1']),
};

describe('P2.7.32 W5 reconciliation decision', () => {
  it('preserves pending R3H2 over stale sequence/current B R2H3', () => {
    expect(reconcileRoundHeat({ ...base, pending: { division: 'OPEN', round: 3, heatId: 2 } }))
      .toEqual({ round: 3, heatId: 2 });
  });
  it('selects first valid target heat when current selection is invalid', () => {
    expect(reconcileRoundHeat({ ...base, currentRound: 3, currentHeatId: 1, pending: null }))
      .toEqual({ round: 3, heatId: 2 });
  });
  it('does not preserve a closed current heat', () => {
    expect(reconcileRoundHeat({ ...base, currentRound: 2, currentHeatId: 1, activeHeatIds: new Set(['r3h1']), pending: null }))
      .toEqual({ round: 2, heatId: 3 });
  });
  it('does not preserve a heat active on another podium', () => {
    expect(reconcileRoundHeat({ ...base, currentRound: 3, currentHeatId: 1, pending: null }))
      .toEqual({ round: 3, heatId: 2 });
  });
  it('keeps ordinary current heat once pending selection is consumed', () => {
    expect(reconcileRoundHeat({ ...base, currentRound: 3, currentHeatId: 2, pending: null })).toBeNull();
  });
});
