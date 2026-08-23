import { describe, expect, it } from 'vitest';
import { computeHeats } from '../bracket';

const participants = Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, name: `OPEN ${i + 1}`, category: 'OPEN' }));

describe('mixed planner integration', () => {
  it('keeps standard planning unchanged when no policy is provided', () => {
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 'auto', variant: 'V1' });
    expect(result.rounds.map((r) => r.heats.length)).toEqual([5, 3, 2, 1]);
  });

  it('generates the OPEN 20 transition shape through the real generator', () => {
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 'auto', variant: 'V1', manOnManFromRound: 3, promoteBestSecond: true });
    // Existing SurfJudging qualification semantics: each R2 heat contributes
    // two qualifiers, so six surfers enter the R3 Man-on-Man phase.
    expect(result.rounds.map((r) => r.heats.length)).toEqual([5, 3, 3, 2, 1]);
    expect(result.rounds.flatMap((r) => r.heats).every((h) => h.slots.length !== 1)).toBe(true);
    expect(result.rounds.slice(2).flatMap((r) => r.heats).every((h) => h.slots.length === 2)).toBe(true);
    expect(result.rounds.flatMap((r) => r.heats).length).toBe(14);
    expect(result.rounds.find((r) => r.roundNumber === 4)?.heats.flatMap((h) => h.slots).some((slot) => slot.placeholder?.startsWith('Meilleur 2e R3'))).toBe(true);
  });
});
