import { calculateSurferStats, rankSurfers, validateScore } from '../../utils/scoring';
import { computeEffectiveInterferences, summarizeInterferenceBySurfer } from '../../utils/interference';

/** Reversible reference facade. No production consumer is switched in P2.3. */
export const legacyScoringFacade = Object.freeze({
  calculateSurferStats,
  rankSurfers,
  validateScore,
  computeEffectiveInterferences,
  summarizeInterferenceBySurfer,
});
