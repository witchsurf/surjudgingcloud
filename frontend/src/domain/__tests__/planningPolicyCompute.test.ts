import { describe, expect, it } from 'vitest';
import { computeHeats } from '../../utils/bracket';
import {
  assertPlanningPolicyPreview,
  computeOptionsForPlanningPolicy,
} from '../planningPolicyCompute';

const participants = Array.from({ length: 13 }, (_, index) => ({
  seed: index + 1,
  name: `Cadet ${index + 1}`,
}));

const policy = {
  event_id: 6,
  category: 'CADET',
  base_format: 'elimination' as const,
  transition_round: 2,
  transition_format: 'man_on_man' as const,
  version: 1,
};

describe('category planning policy computation', () => {
  it('turns a CADET round-2 policy into real two-surfer heats', () => {
    const preview = computeHeats(participants, computeOptionsForPlanningPolicy(policy, 'single-elim'));

    expect(preview.rounds[0].heats.map((heat) => heat.slots.length)).toEqual([4, 3, 3, 3]);
    expect(preview.rounds.slice(1).flatMap((round) => round.heats)
      .every((heat) => heat.slots.length === 2)).toBe(true);
    expect(() => assertPlanningPolicyPreview(policy, preview)).not.toThrow();
  });

  it('builds a seeded bye-aware round-1 man-on-man bracket without a solo heat', () => {
    const roundOnePolicy = {
      ...policy,
      base_format: 'man_on_man' as const,
      transition_round: null,
      transition_format: null,
    };
    const preview = computeHeats(participants, computeOptionsForPlanningPolicy(roundOnePolicy, 'single-elim'));

    expect(() => assertPlanningPolicyPreview(roundOnePolicy, preview)).not.toThrow();
    expect(preview.rounds.map((round) => round.heats.length)).toEqual([5, 4, 2, 1]);
    expect(preview.rounds.flatMap((round) => round.heats)
      .every((heat) => heat.slots.length === 2)).toBe(true);
    expect(preview.progressionEdges?.filter((edge) => edge.type === 'AUTO_ADVANCE_BYE')).toHaveLength(3);
    expect(preview.progressionEdges?.filter((edge) => edge.type === 'COMPETITION_RESULT')).toHaveLength(11);

    const directSeeds = preview.rounds.flatMap((round) => round.heats)
      .flatMap((heat) => heat.slots)
      .flatMap((slot) => slot.seed == null ? [] : [slot.seed])
      .sort((a, b) => a - b);
    expect(directSeeds).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(preview.rounds[1].heats.flatMap((heat) => heat.slots)
      .flatMap((slot) => slot.seed == null ? [] : [slot.seed])
      .sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('uses three opening duels and a best second for six man-on-man entrants', () => {
    const six = participants.slice(0, 6);
    const preview = computeHeats(six, computeOptionsForPlanningPolicy({
      ...policy, base_format: 'man_on_man' as const, transition_round: null, transition_format: null,
    }, 'single-elim'));
    expect(preview.rounds.map((round) => round.heats.length)).toEqual([3, 2, 1]);
    expect(preview.rounds[0].heats.every((heat) => heat.slots.length === 2)).toBe(true);
    expect(preview.rounds[1].heats.flatMap((heat) => heat.slots)
      .some((slot) => slot.placeholder === 'Meilleur 2e R1')).toBe(true);
  });

  it('maps repechage without activating man-on-man', () => {
    expect(computeOptionsForPlanningPolicy({
      ...policy,
      base_format: 'repechage',
      transition_round: null,
      transition_format: null,
    }, 'single-elim')).toMatchObject({
      format: 'repechage',
      manOnManFromRound: undefined,
    });
  });

  it('preserves non-contiguous imported seeds while assigning byes by category rank', () => {
    const importedSeeds = [8, 9, 80, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23];
    const importedParticipants = participants.map((participant, index) => ({
      ...participant,
      seed: importedSeeds[index],
    }));
    const roundOnePolicy = {
      ...policy,
      base_format: 'man_on_man' as const,
      transition_round: null,
      transition_format: null,
    };

    const preview = computeHeats(importedParticipants, computeOptionsForPlanningPolicy(roundOnePolicy, 'single-elim'));
    const directSeeds = preview.rounds.flatMap((round) => round.heats)
      .flatMap((heat) => heat.slots)
      .flatMap((slot) => slot.seed == null ? [] : [slot.seed])
      .sort((a, b) => a - b);

    expect(directSeeds).toEqual([...importedSeeds].sort((a, b) => a - b));
    expect(preview.rounds[1].heats.flatMap((heat) => heat.slots)
      .flatMap((slot) => slot.seed == null ? [] : [slot.seed])
      .sort((a, b) => a - b)).toEqual([8, 9, 10]);
    expect(() => assertPlanningPolicyPreview(roundOnePolicy, preview)).not.toThrow();
  });
});
