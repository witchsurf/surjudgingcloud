import type { EffectiveInterference, Score, SurferStats } from '../../types';
import { SURFER_COLORS } from '../../utils/constants';
import { calculateHeatResult, InvalidOfficialScoreError, UnsupportedPanelSizeError } from './engine';
import type { HeatResultSnapshot, HeatScoringInput, InterferenceDecision, ScoreFact, SupportedPanelSize } from './contracts';
import { legacyScoringFacade } from './legacyFacade';

export type ScoringOperatorIssue = 'unsupported_panel' | 'invalid_official_score' | 'shadow_divergence';

export interface ShadowHeatResult {
  snapshot: HeatResultSnapshot | null;
  stats: SurferStats[];
  legacyStats: SurferStats[];
  parity: boolean;
  source: 'p2' | 'none';
  issue: ScoringOperatorIssue | null;
  message: string | null;
}

export interface ShadowHeatInput {
  heatId: string;
  scores: readonly Score[];
  surfers: readonly string[];
  judgeCount: number;
  judgeStations?: readonly string[];
  maxWaves: number;
  effectiveInterferences?: readonly EffectiveInterference[];
  calculatedAt?: string;
}

const scoreFact = (score: Score, index: number): ScoreFact => ({
  id: score.id || [score.heat_id, score.judge_station || score.judge_id, score.surfer, score.wave_number, score.timestamp, score.created_at, score.score, index].join('::'),
  heatId: score.heat_id,
  lycraColor: score.surfer,
  waveNumber: score.wave_number,
  judgeStation: (score.judge_station || score.judge_id || '').trim().toUpperCase(),
  judgeIdentityId: score.judge_identity_id || null,
  value: Number(score.score),
  timestamp: score.timestamp || score.created_at || '',
  createdAt: score.created_at || score.timestamp || '',
});

const interferenceDecision = (item: EffectiveInterference): InterferenceDecision => ({
  lycraColor: item.surfer,
  waveNumber: item.waveNumber,
  type: item.type,
  source: item.source === 'majority' ? 'panel' : 'head_judge',
  disqualified: false,
});

export const snapshotToSurferStats = (snapshot: HeatResultSnapshot): SurferStats[] => snapshot.competitors.map((competitor) => ({
  surfer: competitor.lycraColor,
  waves: competitor.waves.map((wave) => ({
    wave: wave.waveNumber,
    score: wave.average,
    judgeScores: { ...wave.judgeScores },
    isComplete: wave.complete,
  })),
  bestTwo: competitor.total,
  rank: competitor.rank,
  color: SURFER_COLORS[competitor.lycraColor] || '#6b7280',
  isDisqualified: competitor.disqualified,
  interferenceCount: competitor.interferenceCount,
  interferenceType: competitor.interferenceType,
  interferenceWaves: [...competitor.interferenceWaves],
}));

const parityProjection = (stats: readonly SurferStats[]) => stats.map((item) => ({
  surfer: item.surfer,
  waves: item.waves.map((wave) => ({
    wave: wave.wave,
    score: wave.score,
    judgeScores: Object.fromEntries(Object.entries(wave.judgeScores).sort(([left], [right]) => left.localeCompare(right))),
    isComplete: wave.isComplete,
  })),
  bestTwo: item.bestTwo,
  rank: item.rank,
  isDisqualified: Boolean(item.isDisqualified),
  interferenceCount: item.interferenceCount || 0,
  interferenceType: item.interferenceType || null,
  interferenceWaves: item.interferenceWaves || [],
}));

export function calculateShadowHeatResult(input: ShadowHeatInput): ShadowHeatResult {
  if (input.judgeCount !== 3 && input.judgeCount !== 5) {
    return {
      snapshot: null, stats: [], legacyStats: [], parity: false, source: 'none', issue: 'unsupported_panel',
      message: `Panel ${input.judgeCount} juges non supporté. Configurer exactement 3 ou 5 juges.`,
    };
  }
  const panelSize = input.judgeCount as SupportedPanelSize;
  const effectiveInterferences = input.effectiveInterferences || [];
  const legacyStats = legacyScoringFacade.calculateSurferStats(
    [...input.scores], [...input.surfers], panelSize, input.maxWaves, false, [...effectiveInterferences],
  );
  const engineInput: HeatScoringInput = {
    heatId: input.heatId,
    panel: {
      size: panelSize,
      stations: input.judgeStations?.length
        ? [...input.judgeStations]
        : Array.from({ length: panelSize }, (_, index) => `J${index + 1}`),
    },
    lineup: input.surfers.map((lycraColor) => ({ lycraColor, participant: null })),
    scores: input.scores.map(scoreFact),
    effectiveInterferences: effectiveInterferences.map(interferenceDecision),
    maxWaves: input.maxWaves,
    calculatedAt: input.calculatedAt,
  };

  try {
    const snapshot = calculateHeatResult(engineInput);
    const stats = snapshotToSurferStats(snapshot);
    const parity = JSON.stringify(parityProjection(stats)) === JSON.stringify(parityProjection(legacyStats));
    if (!parity) {
      console.error('[P2 shadow divergence]', {
        heatId: input.heatId,
        legacy: parityProjection(legacyStats),
        p2: parityProjection(stats),
      });
      return {
        snapshot, stats: legacyStats, legacyStats, parity: false, source: 'none', issue: 'shadow_divergence',
        message: 'Divergence scoring P2 détectée : affichage P2 désactivé pour ce heat.',
      };
    }
    return { snapshot, stats, legacyStats, parity: true, source: 'p2', issue: null, message: null };
  } catch (error) {
    if (error instanceof InvalidOfficialScoreError) {
      console.error('[P2 invalid official score]', { heatId: input.heatId, score: error.score, reason: error.reason });
      return {
        snapshot: null, stats: [], legacyStats, parity: false, source: 'none', issue: 'invalid_official_score',
        message: `Note ${error.score.value} invalide : la règle officielle est 0,1 à 10,0 avec une décimale.`,
      };
    }
    if (error instanceof UnsupportedPanelSizeError) {
      return {
        snapshot: null, stats: [], legacyStats: [], parity: false, source: 'none', issue: 'unsupported_panel',
        message: error.message,
      };
    }
    throw error;
  }
}
