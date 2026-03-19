import { describe, expect, it } from 'vitest';
import { generatePreviewHeats, getManOnManRoundOptions } from '../heatGeneration';

const buildParticipants = (count: number, category = 'OPEN') =>
  Array.from({ length: count }, (_, idx) => ({
    seed: idx + 1,
    name: `Surfer ${idx + 1}`,
    category,
  }));

describe('generatePreviewHeats man-on-man activation', () => {
  it('limits man-on-man activation to rounds that actually change the bracket', () => {
    const participants = buildParticipants(10, 'CADET');
    const options = getManOnManRoundOptions(participants, 'elimination', 4);

    expect(options.map((option) => option.round)).toEqual([2, 3]);
    expect(options[0]).toMatchObject({
      round: 2,
      requiresBestSecond: true,
      wildcardSourceRound: 2,
    });
    expect(options[1]).toMatchObject({
      round: 3,
      requiresBestSecond: false,
    });
  });

  it('can inject a best second placeholder to avoid a one-surfer man-on-man heat', () => {
    const participants = buildParticipants(10, 'CADET');

    const brokenBracket = generatePreviewHeats(participants, 'elimination', 4, {
      manOnManFromRound: 2,
    });
    expect(brokenBracket[2].heats.map((heat) => heat.surfers.length)).toEqual([2, 1]);

    const resolvedBracket = generatePreviewHeats(participants, 'elimination', 4, {
      manOnManFromRound: 2,
      promoteBestSecond: true,
    });

    expect(resolvedBracket[2].heats.map((heat) => heat.surfers.length)).toEqual([2, 2]);
    expect(
      resolvedBracket[2].heats.some((heat) =>
        heat.surfers.some((surfer) => surfer.name === 'Meilleur 2e R2')
      )
    ).toBe(true);
    expect(resolvedBracket[3].heats).toHaveLength(1);
    expect(resolvedBracket[3].heats[0].surfers).toHaveLength(2);
  });
});
