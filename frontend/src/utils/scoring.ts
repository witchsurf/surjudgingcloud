export interface ScoreValidation {
  isValid: boolean;
  value?: number;
  error?: string;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function validateScore(input: string): ScoreValidation {
  if (!input.trim()) {
    return { isValid: false, error: 'Score requis' };
  }

  const score = parseFloat(input.replace(',', '.'));

  if (isNaN(score)) {
    return { isValid: false, error: 'Score invalide' };
  }

  if (score < 0 || score > 10) {
    return { isValid: false, error: 'Score doit être entre 0 et 10' };
  }

  // Arrondir à 2 décimales
  const roundedScore = roundScore(score);

  return { isValid: true, value: roundedScore };
}

export function calculateSurferTotal(scores: number[]): { total: number; best2: number } {
  if (scores.length === 0) {
    return { total: 0, best2: 0 };
  }

  const sortedScores = [...scores].sort((a, b) => b - a);
  const best2 = roundScore(sortedScores.slice(0, 2).reduce((sum, score) => sum + score, 0));
  const total = roundScore(scores.reduce((sum, score) => sum + score, 0));

  return { total, best2 };
}

export function rankSurfers(surferScores: Array<{ surfer: string; best2: number }>): Array<{ surfer: string; best2: number; rank: number }> {
  const sorted = [...surferScores].sort((a, b) => {
    if (b.best2 !== a.best2) {
      return b.best2 - a.best2;
    }
    return a.surfer.localeCompare(b.surfer);
  });

  let currentRank = 0;
  let lastScore: number | null = null;

  return sorted.map((item, index) => {
    const roundedBest2 = roundScore(item.best2);
    if (lastScore === null || roundedBest2 !== lastScore) {
      currentRank = index + 1;
      lastScore = roundedBest2;
    }

    return {
      surfer: item.surfer,
      best2: roundedBest2,
      rank: currentRank
    };
  });
}

import type { EffectiveInterference, Score, ScoreOverrideLog, SurferStats, WaveScore } from '../types';
import { SURFER_COLORS } from './constants';
import { summarizeInterferenceBySurfer } from './interference';
import { getScoreJudgeIdentity, getScoreJudgeStation, normalizeScoreJudgeId } from '../api/modules/scoring.api';

function calculateScoreAverage(scores: number[], judgeCount: number): number {
  if (scores.length === 0) return 0;

  const availableScores = [...scores];

  // Lorsque tous les juges ont noté et qu'il y en a 5 ou plus,
  // on enlève la meilleure et la pire note avant de faire la moyenne.
  if (judgeCount >= 5 && availableScores.length >= judgeCount) {
    availableScores.sort((a, b) => a - b);
    const trimmed = availableScores.slice(1, availableScores.length - 1);
    if (trimmed.length > 0) {
      const trimmedAverage = trimmed.reduce((sum, score) => sum + score, 0) / trimmed.length;
      return roundScore(trimmedAverage);
    }
  }

  const average = availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length;
  return roundScore(average);
}

export function calculateSurferStats(
  scores: Score[],
  surfers: string[],
  judgeCount: number,
  maxWaves: number = 12,
  allowIncomplete: boolean = false,
  effectiveInterferences: EffectiveInterference[] = []
): SurferStats[] {
  const interferenceBySurfer = summarizeInterferenceBySurfer(effectiveInterferences);
  const surferStats = surfers.map(surfer => {
    // Grouper les scores par vague
    const waveScores: Record<number, Record<string, number>> = {};

    scores
      .filter(score => {
        const scoreSurfer = (score.surfer || '').trim().toUpperCase();
        const targetSurfer = (surfer || '').trim().toUpperCase();
        return scoreSurfer === targetSurfer;
      })
      .forEach(score => {
        if (score.wave_number < 1 || score.wave_number > maxWaves) {
          return;
        }
        if (!waveScores[score.wave_number]) {
          waveScores[score.wave_number] = {};
        }
        // Utiliser une clé normalisée pour le juge pour éviter les doublons/mishaps
        const judgeKey = getScoreJudgeStation(score);
        waveScores[score.wave_number][judgeKey] = score.score;
      });

    // Calculer les moyennes pour chaque vague
    const allWaves: WaveScore[] = Array.from({ length: maxWaves }, (_, index) => {
      const waveNumber = index + 1;
      const judgeScores = waveScores[waveNumber] ?? {};
      const judgeScoreValues = Object.values(judgeScores);

      // Si allowIncomplete est vrai (ex: heat terminé), on accepte n'importe quel score > 0
      // Sinon, on exige que tous les juges aient noté
      const isComplete = allowIncomplete
        ? judgeScoreValues.length > 0
        : judgeScoreValues.length === judgeCount;

      const average = judgeScoreValues.length > 0 ? calculateScoreAverage(judgeScoreValues, judgeCount) : 0;

      return {
        wave: waveNumber,
        score: average,
        judgeScores,
        isComplete
      };
    });

    let lastWaveWithData = -1;
    allWaves.forEach((wave, idx) => {
      if (wave.score > 0 || Object.keys(wave.judgeScores).length > 0) {
        lastWaveWithData = idx;
      }
    });

    const waves = lastWaveWithData >= 0 ? allWaves.slice(0, lastWaveWithData + 1) : allWaves.slice(0, 1);

    // Trier par score décroissant et prendre les 2 meilleures (seulement les vagues complètes)
    const completeWaves = waves.filter(wave => wave.isComplete);
    const sortedWaves = [...completeWaves].sort((a, b) => b.score - a.score);
    const summary = interferenceBySurfer.get(surfer.toUpperCase());
    const isDisqualified = Boolean(summary?.isDisqualified);
    const waveA = sortedWaves[0]?.score ?? 0;
    const waveB = sortedWaves[1]?.score ?? 0;
    let bestTwo = roundScore(waveA + waveB);
    const penalizedSecondWave = summary?.type === 'INT2' ? sortedWaves[1]?.wave : undefined;

    if (isDisqualified) {
      bestTwo = 0;
    } else if (summary?.type === 'INT1') {
      bestTwo = roundScore(waveA + (waveB / 2));
    } else if (summary?.type === 'INT2') {
      bestTwo = roundScore(waveA);
    }

    const displayWaves = waves.map((wave) => {
      if (penalizedSecondWave && wave.wave === penalizedSecondWave) {
        return {
          ...wave,
          score: 0
        };
      }
      return wave;
    });

    return {
      surfer,
      waves: displayWaves,
      bestTwo,
      rank: 1,
      color: SURFER_COLORS[surfer as keyof typeof SURFER_COLORS] || '#6b7280',
      isDisqualified,
      interferenceCount: summary?.count ?? 0,
      interferenceType: summary?.type ?? null,
    };
  });

  // Calculer les rangs
  const eligible = surferStats
    .filter((stats) => !stats.isDisqualified)
    .map(({ surfer, bestTwo }) => ({ surfer, best2: bestTwo }));
  const ranked = rankSurfers(eligible);
  const rankBySurfer = new Map(ranked.map(item => [item.surfer, item.rank]));
  const bestTwoBySurfer = new Map(ranked.map(item => [item.surfer, item.best2]));
  const dsqRank = ranked.length + 1;

  const withRanks = surferStats.map(stats => ({
    ...stats,
    bestTwo: stats.isDisqualified ? 0 : (bestTwoBySurfer.get(stats.surfer) ?? stats.bestTwo),
    rank: stats.isDisqualified ? dsqRank : (rankBySurfer.get(stats.surfer) ?? stats.rank)
  }));

  withRanks.sort((a, b) => {
    if (a.isDisqualified && !b.isDisqualified) return 1;
    if (!a.isDisqualified && b.isDisqualified) return -1;
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.surfer.localeCompare(b.surfer);
  });

  return withRanks;
}

export function getEffectiveJudgeCount(scores: Score[], configuredCount?: number): number {
  const uniqueJudges = new Set(
    scores
      .map((score) => getScoreJudgeStation(score))
      .filter((judgeId): judgeId is string => Boolean(judgeId))
  ).size;

  if (configuredCount && configuredCount > 0) {
    // Display/admin rules are based on configured judges.
    // This prevents early partial display when only 1/3 judges has scored.
    return configuredCount;
  }

  return Math.max(uniqueJudges, 1);
}

export interface JudgeAccuracyStats {
  judgeId: string;
  scoredWaves: number;
  consensusSamples: number;
  meanAbsDeviation: number;
  bias: number;
  withinHalfPointRate: number;
  overrideCount: number;
  overrideRate: number;
  averageOverrideDelta: number;
  qualityScore: number;
  qualityBand: 'excellent' | 'good' | 'watch' | 'needs_review';
}

export interface JudgeDeviationDetail {
  judgeId: string;
  heatId: string;
  surfer: string;
  waveNumber: number;
  judgeScore: number;
  consensusScore: number;
  delta: number;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundScore((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return roundScore(sorted[mid]);
};

export function calculateJudgeAccuracy(
  scores: Score[],
  overrideLogs: ScoreOverrideLog[],
  configuredJudges: string[] = []
): JudgeAccuracyStats[] {
  const activeByWave = new Map<string, Score[]>();
  const normalizedJudges = Array.from(new Set(
    configuredJudges
      .map((judge) => (judge || '').trim().toUpperCase())
      .filter(Boolean)
  ));

  scores.forEach((score) => {
    const judgeId = normalizeScoreJudgeId(score.judge_id);
    const judgeIdentityId = getScoreJudgeIdentity(score);
    if (!judgeId) return;
    const key = `${(score.heat_id || '').trim()}::${(score.surfer || '').trim().toUpperCase()}::${Number(score.wave_number)}`;
    if (!activeByWave.has(key)) activeByWave.set(key, []);
    activeByWave.get(key)!.push({
      ...score,
      judge_id: judgeIdentityId
    });
  });

  const perJudge = new Map<string, {
    scoredWaves: number;
    consensusSamples: number;
    deviationSum: number;
    signedDeviationSum: number;
    withinHalfPointCount: number;
  }>();

  activeByWave.forEach((waveScores) => {
    waveScores.forEach((score) => {
      const judgeId = score.judge_id.trim().toUpperCase();
      const normalizedJudgeId = normalizeScoreJudgeId(judgeId);
      if (!perJudge.has(normalizedJudgeId)) {
        perJudge.set(normalizedJudgeId, {
          scoredWaves: 0,
          consensusSamples: 0,
          deviationSum: 0,
          signedDeviationSum: 0,
          withinHalfPointCount: 0,
        });
      }

      const stats = perJudge.get(normalizedJudgeId)!;
      stats.scoredWaves += 1;

      const peerScores = waveScores
        .filter((peer) => normalizeScoreJudgeId(peer.judge_id) !== normalizedJudgeId)
        .map((peer) => peer.score);

      if (peerScores.length === 0) return;

      const consensus = median(peerScores);
      const delta = roundScore(score.score - consensus);
      stats.consensusSamples += 1;
      stats.deviationSum += Math.abs(delta);
      stats.signedDeviationSum += delta;
      if (Math.abs(delta) <= 0.5) {
        stats.withinHalfPointCount += 1;
      }
    });
  });

  const overrideByJudge = new Map<string, { count: number; deltaSum: number }>();
  overrideLogs.forEach((log) => {
    const judgeId = normalizeScoreJudgeId(log.judge_id);
    const judgeIdentityId = (log.judge_identity_id || '').trim() || judgeId;
    if (!judgeIdentityId) return;
    const current = overrideByJudge.get(judgeIdentityId) ?? { count: 0, deltaSum: 0 };
    current.count += 1;
    current.deltaSum += Math.abs((log.new_score ?? 0) - (log.previous_score ?? 0));
    overrideByJudge.set(judgeIdentityId, current);
  });

  const judgeIds = Array.from(new Set([
    ...normalizedJudges,
    ...Array.from(perJudge.keys()),
    ...Array.from(overrideByJudge.keys())
  ]));

  return judgeIds
    .map((judgeId) => {
      const scoreStats = perJudge.get(judgeId) ?? {
        scoredWaves: 0,
        consensusSamples: 0,
        deviationSum: 0,
        signedDeviationSum: 0,
        withinHalfPointCount: 0,
      };
      const overrideStats = overrideByJudge.get(judgeId) ?? { count: 0, deltaSum: 0 };

      return {
        judgeId,
        scoredWaves: scoreStats.scoredWaves,
        consensusSamples: scoreStats.consensusSamples,
        meanAbsDeviation: scoreStats.consensusSamples > 0
          ? roundScore(scoreStats.deviationSum / scoreStats.consensusSamples)
          : 0,
        bias: scoreStats.consensusSamples > 0
          ? roundScore(scoreStats.signedDeviationSum / scoreStats.consensusSamples)
          : 0,
        withinHalfPointRate: scoreStats.consensusSamples > 0
          ? roundScore((scoreStats.withinHalfPointCount / scoreStats.consensusSamples) * 100)
          : 0,
        overrideCount: overrideStats.count,
        overrideRate: scoreStats.scoredWaves > 0
          ? roundScore((overrideStats.count / scoreStats.scoredWaves) * 100)
          : 0,
        averageOverrideDelta: overrideStats.count > 0
          ? roundScore(overrideStats.deltaSum / overrideStats.count)
          : 0,
        qualityScore: 0,
        qualityBand: 'needs_review' as const,
      };
    })
    .map((row) => {
      const deviationPenalty = Math.min(45, row.meanAbsDeviation * 30);
      const biasPenalty = Math.min(15, Math.abs(row.bias) * 20);
      const overridePenalty = Math.min(20, row.overrideRate * 0.5);
      const withinBonus = Math.min(10, row.withinHalfPointRate * 0.1);
      const qualityScore = Math.max(0, Math.min(100, roundScore(100 - deviationPenalty - biasPenalty - overridePenalty + withinBonus)));
      const qualityBand =
        qualityScore >= 85 ? 'excellent' :
        qualityScore >= 70 ? 'good' :
        qualityScore >= 55 ? 'watch' :
        'needs_review';

      return {
        ...row,
        qualityScore,
        qualityBand,
      };
    })
    .sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      if (a.meanAbsDeviation !== b.meanAbsDeviation) {
        return a.meanAbsDeviation - b.meanAbsDeviation;
      }
      return a.judgeId.localeCompare(b.judgeId);
    });
}

export function buildJudgeDeviationDetails(scores: Score[], judgeId: string): JudgeDeviationDetail[] {
  const normalizedJudgeId = normalizeScoreJudgeId(judgeId);
  if (!normalizedJudgeId) return [];

  const activeByWave = new Map<string, Score[]>();
  scores.forEach((score) => {
    const normalizedScoreJudgeId = normalizeScoreJudgeId(score.judge_id);
    const judgeIdentityId = getScoreJudgeIdentity(score);
    if (!normalizedScoreJudgeId) return;
    const key = `${(score.heat_id || '').trim()}::${(score.surfer || '').trim().toUpperCase()}::${Number(score.wave_number)}`;
    if (!activeByWave.has(key)) activeByWave.set(key, []);
    activeByWave.get(key)!.push({
      ...score,
      judge_id: judgeIdentityId
    });
  });

  const details: JudgeDeviationDetail[] = [];
  activeByWave.forEach((waveScores) => {
    const judgeScore = waveScores.find((score) => normalizeScoreJudgeId(score.judge_id) === normalizedJudgeId);
    if (!judgeScore) return;

    const peerScores = waveScores
      .filter((score) => normalizeScoreJudgeId(score.judge_id) !== normalizedJudgeId)
      .map((score) => score.score);

    if (!peerScores.length) return;

    const consensusScore = median(peerScores);
    details.push({
      judgeId: normalizedJudgeId,
      heatId: judgeScore.heat_id,
      surfer: judgeScore.surfer,
      waveNumber: judgeScore.wave_number,
      judgeScore: judgeScore.score,
      consensusScore,
      delta: roundScore(judgeScore.score - consensusScore),
    });
  });

  return details.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
