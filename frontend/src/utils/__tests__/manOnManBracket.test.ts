import { describe, expect, it } from 'vitest';
import { buildManOnManBracket } from '../manOnManBracket';

describe('buildManOnManBracket', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('builds a deterministic two-slot bracket for %i qualifiers', (count) => {
    const bracket = buildManOnManBracket(count);
    const again = buildManOnManBracket(count);
    expect(bracket).toEqual(again);
    expect(bracket.matches.length).toBeGreaterThanOrEqual(1);
    expect(bracket.matches.every((m) => m.slots.length === 2)).toBe(true);
    expect(bracket.byeCount).toBe(2 ** Math.ceil(Math.log2(count)) - count);
    const targets = bracket.edges.map((e) => `${e.targetRound}:${e.targetHeat}:${e.targetPosition}`);
    expect(new Set(targets).size).toBe(targets.length);
    expect(bracket.edges.filter((e) => e.type === 'AUTO_ADVANCE_BYE').length).toBe(bracket.byeCount);
  });

  it('never represents a bye as a match or participant', () => {
    const bracket = buildManOnManBracket(6);
    expect(bracket.matches.some((m) => m.slots.length !== 2)).toBe(false);
    expect(bracket.edges.filter((e) => e.type === 'AUTO_ADVANCE_BYE').every((e) => e.sourceHeat === 0 && e.sourcePosition === 0)).toBe(true);
  });
});
