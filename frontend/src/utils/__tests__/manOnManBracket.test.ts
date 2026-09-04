import { describe, expect, it } from 'vitest';
import { buildManOnManBracket } from '../manOnManBracket';
import { getManOnManRoundOptions } from '../heatGeneration';

describe('buildManOnManBracket', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 13])('builds a deterministic two-slot bracket for %i qualifiers', (count) => {
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

  it('seeds 13 qualifiers with three auditable byes and no avoidable bye-v-bye pairing', () => {
    const bracket = buildManOnManBracket(13);
    const byes = bracket.edges.filter((edge) => edge.type === 'AUTO_ADVANCE_BYE');
    expect(byes.map((edge) => edge.byeSeed).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3]);
    expect(new Set(byes.map((edge) => `${edge.targetRound}:${edge.targetHeat}`)).size).toBe(3);
    expect(bracket.matches.filter((match) => match.round === 1).map((match) => match.slots)).toEqual([
      [8, 9], [4, 13], [5, 12], [7, 10], [6, 11],
    ]);
  });

  it('never represents a bye as a match or participant', () => {
    const bracket = buildManOnManBracket(6);
    expect(bracket.matches.some((m) => m.slots.length !== 2)).toBe(false);
    expect(bracket.edges.filter((e) => e.type === 'AUTO_ADVANCE_BYE').every((e) => e.sourceHeat === 0 && e.sourcePosition === 0)).toBe(true);
  });

  it('offers round-1 man-on-man without an untraceable best-second wildcard', () => {
    const participants = Array.from({ length: 6 }, (_, index) => ({
      seed: index + 1,
      name: `Ondine ${index + 1}`,
    }));

    expect(getManOnManRoundOptions(participants, 'elimination', 4)).toContainEqual({
      round: 1,
      requiresBestSecond: false,
    });
  });
});
