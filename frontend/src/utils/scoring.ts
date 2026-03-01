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

import type { EffectiveInterference, Score, SurferStats, WaveScore } from '../types';
import { SURFER_COLORS } from './constants';
import { summarizeInterferenceBySurfer } from './interference';

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
        const judgeKey = (score.judge_id || '').trim().toUpperCase();
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

    if (isDisqualified) {
      bestTwo = 0;
    } else if (summary?.type === 'INT1') {
      bestTwo = roundScore(waveA + (waveB / 2));
    } else if (summary?.type === 'INT2') {
      bestTwo = roundScore(waveA);
    }

    return {
      surfer,
      waves,
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
      .map((score) => score.judge_id)
      .filter((judgeId): judgeId is string => Boolean(judgeId))
  ).size;

  if (configuredCount && configuredCount > 0) {
    // Display/admin rules are based on configured judges.
    // This prevents early partial display when only 1/3 judges has scored.
    return configuredCount;
  }

  return Math.max(uniqueJudges, 1);
}
