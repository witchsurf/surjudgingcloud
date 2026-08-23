import { describe, it, expect } from 'vitest';
import { computeNeededScores, calculateSurferStats } from '../scoring';
import type { Score, SurferStats } from '../../types';

const buildStats = (
  surfer: string,
  rank: number,
  waves: number[],
  bestTwo?: number
): SurferStats => {
  const waveObjs = waves.map((avg, i) => ({
    waveNumber: i + 1,
    score: avg,
    average: avg,
    isComplete: true,
    complete: true,
    judgeScores: { J1: avg },
  }));
  const completed = waveObjs.filter((w) => w.score > 0);
  const sorted = [...completed].sort((a, b) => b.score - a.score);
  const calculatedBestTwo = bestTwo ?? (
    (sorted[0]?.score || 0) + (sorted[1]?.score || 0)
  );

  return {
    surfer,
    rank,
    total: calculatedBestTwo,
    bestTwo: calculatedBestTwo,
    waves: waveObjs,
    bestWaves: sorted.slice(0, 2),
    interferenceType: null,
    interferenceCount: 0,
    hasInterference: false,
    disqualified: false,
  };
};

describe('computeNeededScores in Final vs Non-Final', () => {
  describe('4-Surfer Final (isFinal = true)', () => {
    it('calculates Needs for 2nd, 3rd, 4th relative to Leader (1st place)', () => {
      // Leader: 15.00 (8.00 + 7.00)
      // 2nd:    13.50 (7.00 + 6.50) -> needs 8.01 to reach 15.01 (7.00 + 8.01)
      // 3rd:    11.00 (6.00 + 5.00) -> needs 9.01 to reach 15.01 (6.00 + 9.01)
      // 4th:     8.00 (4.50 + 3.50) -> needs 10.51 -> Combo (15.01)
      const stats: SurferStats[] = [
        buildStats('ROUGE', 1, [8.0, 7.0]),
        buildStats('BLANC', 2, [7.0, 6.5]),
        buildStats('JAUNE', 3, [6.0, 5.0]),
        buildStats('BLEU', 4, [4.5, 3.5]),
      ];

      const needs = computeNeededScores(stats, { isFinal: true });

      // Leader has no need
      expect(needs['ROUGE']).toBeUndefined();

      // 2nd place
      expect(needs['BLANC']).toBeDefined();
      expect(needs['BLANC']?.needed).toBe(8.01);
      expect(needs['BLANC']?.targetRank).toBe(1);
      expect(needs['BLANC']?.label).toBe('to 1st');
      expect(needs['BLANC']?.isCombo).toBe(false);

      // 3rd place
      expect(needs['JAUNE']).toBeDefined();
      expect(needs['JAUNE']?.needed).toBe(9.01);
      expect(needs['JAUNE']?.targetRank).toBe(1);
      expect(needs['JAUNE']?.label).toBe('to 1st');
      expect(needs['JAUNE']?.isCombo).toBe(false);

      // 4th place (Combo > 10)
      expect(needs['BLEU']).toBeDefined();
      expect(needs['BLEU']?.targetRank).toBe(1);
      expect(needs['BLEU']?.label).toBe('to 1st');
      expect(needs['BLEU']?.isCombo).toBe(true);
      expect(needs['BLEU']?.needed).toBe(15.01);
    });
  });

  describe('2-Surfer Final (Man-on-Man, isFinal = true)', () => {
    it('calculates Need for 2nd place relative to Leader', () => {
      const stats: SurferStats[] = [
        buildStats('ROUGE', 1, [7.5, 6.5]), // Total: 14.00
        buildStats('BLANC', 2, [6.0, 5.5]), // Total: 11.50 -> needs 8.01 (6.00 + 8.01 = 14.01)
      ];

      const needs = computeNeededScores(stats, { isFinal: true });

      expect(needs['ROUGE']).toBeUndefined();
      expect(needs['BLANC']?.needed).toBe(8.01);
      expect(needs['BLANC']?.targetRank).toBe(1);
      expect(needs['BLANC']?.label).toBe('to 1st');
      expect(needs['BLANC']?.isCombo).toBe(false);
    });
  });

  describe('Surfer with 0, 1 or >=2 waves in Final', () => {
    it('handles surfer with 0 waves in final', () => {
      const stats: SurferStats[] = [
        buildStats('ROUGE', 1, [8.0, 6.0]), // Total: 14.00
        buildStats('BLANC', 2, []),          // Total: 0.00 -> needs 14.01 -> Combo
      ];

      const needs = computeNeededScores(stats, { isFinal: true });
      expect(needs['BLANC']?.isCombo).toBe(true);
      expect(needs['BLANC']?.needed).toBe(14.01);
      expect(needs['BLANC']?.targetRank).toBe(1);
    });

    it('handles surfer with 1 wave in final', () => {
      const stats: SurferStats[] = [
        buildStats('ROUGE', 1, [7.0, 6.0]), // Total: 13.00
        buildStats('BLANC', 2, [6.5]),       // Total: 6.50 -> needs 6.51 to beat 13.00 (6.50 + 6.51 = 13.01)
      ];

      const needs = computeNeededScores(stats, { isFinal: true });
      expect(needs['BLANC']?.needed).toBe(6.51);
      expect(needs['BLANC']?.targetRank).toBe(1);
      expect(needs['BLANC']?.isCombo).toBe(false);
    });
  });

  describe('Non-Final Round (isFinal = false)', () => {
    it('calculates Needs for 3rd and 4th relative to 2nd place (to ADV)', () => {
      // Leader: 15.00
      // 2nd:    13.00 (7.00 + 6.00)
      // 3rd:    11.00 (6.00 + 5.00) -> needs 7.01 to beat 2nd place 13.00 (6.00 + 7.01 = 13.01)
      // 4th:     8.00 (5.00 + 3.00) -> needs 8.01 to beat 2nd place 13.00 (5.00 + 8.01 = 13.01)
      const stats: SurferStats[] = [
        buildStats('ROUGE', 1, [8.0, 7.0]),
        buildStats('BLANC', 2, [7.0, 6.0]),
        buildStats('JAUNE', 3, [6.0, 5.0]),
        buildStats('BLEU', 4, [5.0, 3.0]),
      ];

      const needs = computeNeededScores(stats, { isFinal: false, qualificationCount: 2 });

      expect(needs['ROUGE']).toBeUndefined();
      expect(needs['BLANC']?.targetRank).toBe(1);
      expect(needs['BLANC']?.label).toBe('to 1st');

      expect(needs['JAUNE']?.needed).toBe(7.01);
      expect(needs['JAUNE']?.targetRank).toBe(2);
      expect(needs['JAUNE']?.label).toBe('to ADV');

      expect(needs['BLEU']?.needed).toBe(8.01);
      expect(needs['BLEU']?.targetRank).toBe(2);
      expect(needs['BLEU']?.label).toBe('to ADV');
    });
  });
});
