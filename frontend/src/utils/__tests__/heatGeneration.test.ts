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

  it('allows starting directly in man-on-man from round 1 when the category can support it', () => {
    const participants = buildParticipants(4, 'MINIME');
    const options = getManOnManRoundOptions(participants, 'elimination', 4);
    const manOnManBracket = generatePreviewHeats(participants, 'elimination', 4, {
      manOnManFromRound: 1,
    });

    expect(options.map((option) => option.round)).toContain(1);
    expect(manOnManBracket).toHaveLength(2);
    expect(manOnManBracket[0].heats).toHaveLength(2);
    expect(manOnManBracket[0].heats.every((heat) => heat.surfers.length === 2)).toBe(true);
    expect(manOnManBracket[1].heats[0].surfers).toHaveLength(2);
  });

  it('auto-promotes a best second when a round-1 man-on-man bracket becomes odd', () => {
    const participants = buildParticipants(6, 'CADET');

    const brokenBracket = generatePreviewHeats(participants, 'elimination', 4, {
      manOnManFromRound: 1,
    });
    expect(brokenBracket[1].heats.map((heat) => heat.surfers.length)).toEqual([2, 1]);

    const resolvedBracket = generatePreviewHeats(participants, 'elimination', 4, {
      manOnManFromRound: 1,
      promoteBestSecond: true,
    });

    expect(resolvedBracket[1].heats.map((heat) => heat.surfers.length)).toEqual([2, 2]);
    expect(
      resolvedBracket[1].heats.some((heat) =>
        heat.surfers.some((surfer) => surfer.name === 'Meilleur 2e R1')
      )
    ).toBe(true);
    expect(
      resolvedBracket.flatMap((round) => round.heats.flatMap((heat) => heat.surfers))
        .filter((surfer) => surfer.name.startsWith('Meilleur 2e '))
    ).toHaveLength(1);
    expect(resolvedBracket[2].heats[0].surfers).toHaveLength(2);
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
    expect(
      resolvedBracket.flatMap((round) => round.heats.flatMap((heat) => heat.surfers))
        .filter((surfer) => surfer.name.startsWith('Meilleur 2e '))
    ).toHaveLength(1);
    expect(resolvedBracket[3].heats).toHaveLength(1);
    expect(resolvedBracket[3].heats[0].surfers).toHaveLength(2);
  });

  it('keeps round-1 heat mates apart when activating man-on-man in round 2', () => {
    const participants = buildParticipants(12, 'OPEN');
    const bracket = generatePreviewHeats(participants, 'elimination', 4, {
      manOnManFromRound: 2,
    });

    const roundTwo = bracket.find((round) => round.round === 2);
    expect(roundTwo?.heats).toHaveLength(3);

    const sourceHeatsByRoundTwoHeat = roundTwo?.heats.map((heat) =>
      heat.surfers.map((surfer) => {
        const match = surfer.name.match(/R1-H(\d+)/);
        return match?.[1];
      })
    );

    expect(sourceHeatsByRoundTwoHeat).toEqual([
      ['1', '2'],
      ['2', '3'],
      ['3', '1'],
    ]);
  });
});
