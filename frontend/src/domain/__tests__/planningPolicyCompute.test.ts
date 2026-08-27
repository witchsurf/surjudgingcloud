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

  it('fails closed when a round-1 man-on-man policy would create a solo heat', () => {
    const roundOnePolicy = {
      ...policy,
      base_format: 'man_on_man' as const,
      transition_round: null,
      transition_format: null,
    };
    const preview = computeHeats(participants, computeOptionsForPlanningPolicy(roundOnePolicy, 'single-elim'));

    expect(() => assertPlanningPolicyPreview(roundOnePolicy, preview))
      .toThrow(/heat de 1 surfeur/);
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
});
