export interface ScoreValidation {
  isValid: boolean;
  value?: number;
  error?: string;
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
  const roundedScore = Math.round(score * 100) / 100;
  
  return { isValid: true, value: roundedScore };
}

export function calculateSurferTotal(scores: number[]): { total: number; best2: number } {
  if (scores.length === 0) {
    return { total: 0, best2: 0 };
  }

  const sortedScores = [...scores].sort((a, b) => b - a);
  const best2 = sortedScores.slice(0, 2).reduce((sum, score) => sum + score, 0);
  const total = scores.reduce((sum, score) => sum + score, 0);

  return { total, best2 };
}

export function rankSurfers(surferScores: Array<{ surfer: string; best2: number }>): Array<{ surfer: string; best2: number; rank: number }> {
  const sorted = [...surferScores].sort((a, b) => b.best2 - a.best2);
  
  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1
  }));
}

import type { Score, SurferStats, WaveScore } from '../types';
import { SURFER_COLORS } from './constants';

function calculateScoreAverage(scores: number[], judgeCount: number): number {
  if (scores.length === 0) return 0;
  
  // Si on a moins de scores que de juges, on fait la moyenne des scores disponibles
  if (scores.length < judgeCount) {
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  
  // Si on a tous les scores, on fait la moyenne normale
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function calculateSurferStats(
  scores: Score[], 
  surfers: string[], 
  judgeCount: number,
  maxWaves: number = 12
): SurferStats[] {
  const surferStats = surfers.map(surfer => {
    // Grouper les scores par vague
    const waveScores: Record<number, Record<string, number>> = {};
    
    scores
      .filter(score => score.surfer === surfer)
      .forEach(score => {
        if (!waveScores[score.wave_number]) {
          waveScores[score.wave_number] = {};
        }
        waveScores[score.wave_number][score.judge_id] = score.score;
      });

    // Calculer les moyennes pour chaque vague
    const waves: WaveScore[] = Object.entries(waveScores).map(([waveNum, judgeScores]) => {
      const judgeScoreValues = Object.values(judgeScores);
      const isComplete = Object.keys(judgeScores).length === judgeCount;
      // Calculer la moyenne même si incomplète, mais marquer comme incomplète
      const average = judgeScoreValues.length > 0 ? calculateScoreAverage(judgeScoreValues, judgeScoreValues.length) : 0;
      
      return {
        wave: parseInt(waveNum),
        score: average,
        judgeScores,
        isComplete
      };
    });

    // Trier par score décroissant et prendre les 2 meilleures (seulement les vagues complètes)
    const completeWaves = waves.filter(wave => wave.isComplete);
    const sortedWaves = [...completeWaves].sort((a, b) => b.score - a.score);
    const bestTwo = (sortedWaves[0]?.score || 0) + (sortedWaves[1]?.score || 0);

    return {
      surfer,
      waves,
      bestTwo,
      rank: 1,
      color: SURFER_COLORS[surfer as keyof typeof SURFER_COLORS] || '#6b7280'
    };
  });

  // Calculer les rangs
  surferStats.sort((a, b) => b.bestTwo - a.bestTwo);
  surferStats.forEach((stats, index) => {
    stats.rank = index + 1;
  });

  return surferStats;
}