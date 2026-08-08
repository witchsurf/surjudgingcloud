/** Pure domain contracts for one heat. No React or Supabase dependency. */

export type SupportedPanelSize = 3 | 5;
export type ScoreValidationReason = 'not_finite' | 'below_minimum' | 'above_maximum' | 'invalid_precision';
export type InterferenceCallType = 'INT1' | 'INT2';

export interface ScoringPolicy {
  readonly minScore: 0.1;
  readonly maxScore: 10;
  readonly decimalPlaces: 1;
  readonly waveAverageDecimalPlaces: 2;
  readonly bestWaveCount: 2;
  readonly supportedPanelSizes: readonly [3, 5];
  readonly incompleteWavesCountTowardsTotal: false;
  readonly lastWriteWinsOrder: readonly ['timestamp', 'createdAt', 'id'];
}

export const OFFICIAL_SCORING_POLICY: ScoringPolicy = Object.freeze({
  minScore: 0.1,
  maxScore: 10,
  decimalPlaces: 1,
  waveAverageDecimalPlaces: 2,
  bestWaveCount: 2,
  supportedPanelSizes: [3, 5],
  incompleteWavesCountTowardsTotal: false,
  lastWriteWinsOrder: ['timestamp', 'createdAt', 'id'],
});

export interface ScorePolicyValidation {
  valid: boolean;
  reason?: ScoreValidationReason;
}

/** Contract-level boundary check. The P2.3 engine will use this policy. */
export function validateOfficialScore(value: number): ScorePolicyValidation {
  if (!Number.isFinite(value)) return { valid: false, reason: 'not_finite' };
  if (value < OFFICIAL_SCORING_POLICY.minScore) return { valid: false, reason: 'below_minimum' };
  if (value > OFFICIAL_SCORING_POLICY.maxScore) return { valid: false, reason: 'above_maximum' };
  if (Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) {
    return { valid: false, reason: 'invalid_precision' };
  }
  return { valid: true };
}

/** A score is canonically attached to a lycra color, never to a participant. */
export interface ScoreFact {
  id: string;
  heatId: string;
  lycraColor: string;
  waveNumber: number;
  judgeStation: string;
  judgeIdentityId?: string | null;
  value: number;
  timestamp: string;
  createdAt: string;
}

export interface ParticipantDisplayMetadata {
  participantId?: number | null;
  displayName?: string | null;
  country?: string | null;
  club?: string | null;
}

export interface HeatLineupEntry {
  lycraColor: string;
  participant: ParticipantDisplayMetadata | null;
}

export interface PanelDefinition {
  size: SupportedPanelSize;
  stations: readonly string[];
}

export interface WaveResult {
  waveNumber: number;
  judgeScores: Readonly<Record<string, number>>;
  retainedScores: readonly number[];
  average: number;
  complete: boolean;
  countsTowardsTotal: boolean;
}

export interface InterferenceDecision {
  lycraColor: string;
  waveNumber: number;
  type: InterferenceCallType;
  source: 'panel' | 'head_judge';
  disqualified: boolean;
}

export interface InterferenceVote {
  id: string;
  lycraColor: string;
  waveNumber: number;
  judgeStation: string;
  type: InterferenceCallType;
  timestamp: string;
  createdAt: string;
  headJudgeOverride: boolean;
}

export interface HeatScoringInput {
  heatId: string;
  panel: PanelDefinition;
  lineup: readonly HeatLineupEntry[];
  scores: readonly ScoreFact[];
  effectiveInterferences?: readonly InterferenceDecision[];
  maxWaves?: number;
  calculatedAt?: string;
}

export interface CompetitorHeatResult {
  lycraColor: string;
  participant: ParticipantDisplayMetadata | null;
  waves: readonly WaveResult[];
  bestWaveNumbers: readonly number[];
  total: number;
  rank: number;
  disqualified: boolean;
  interferenceCount: number;
  interferenceType: InterferenceCallType | null;
  interferenceWaves: readonly { waveNumber: number; type: InterferenceCallType }[];
}

export interface HeatResultSnapshot {
  heatId: string;
  panel: PanelDefinition;
  competitors: readonly CompetitorHeatResult[];
  calculatedAt: string;
}
