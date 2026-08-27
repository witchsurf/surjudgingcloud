import type { CategoryPlanningPolicy } from './planningPolicy';
import type { ComputeOptions, ComputeResult, FormatType } from '../utils/bracket';

export const computeOptionsForPlanningPolicy = (
  policy: CategoryPlanningPolicy,
  legacyFormat: FormatType,
): ComputeOptions => {
  const format: FormatType = policy.base_format === 'repechage'
    ? 'repechage'
    : policy.base_format === 'elimination' || policy.base_format === 'man_on_man'
      ? 'single-elim'
      : legacyFormat;
  const manOnManFromRound = policy.base_format === 'man_on_man'
    ? 1
    : policy.transition_format === 'man_on_man'
      ? policy.transition_round ?? undefined
      : undefined;

  return {
    format,
    preferredHeatSize: 'auto',
    variant: 'V1',
    manOnManFromRound,
    promoteBestSecond: manOnManFromRound != null,
  };
};

export const assertPlanningPolicyPreview = (
  policy: CategoryPlanningPolicy,
  preview: ComputeResult,
) => {
  const activatesManOnMan = policy.base_format === 'man_on_man'
    || policy.transition_format === 'man_on_man';
  if (!activatesManOnMan) return;

  const firstManOnManRound = policy.base_format === 'man_on_man'
    ? 1
    : policy.transition_round ?? Number.POSITIVE_INFINITY;
  const invalidHeat = preview.rounds
    .filter((round) => round.roundNumber >= firstManOnManRound)
    .flatMap((round) => round.heats)
    .find((heat) => heat.slots.length !== 2);

  if (invalidHeat) {
    throw new Error(
      `${policy.category}: le man-on-man produirait un heat de ${invalidHeat.slots.length} surfeur(s). `
      + 'Choisissez une transition vers un round compatible.',
    );
  }
};
