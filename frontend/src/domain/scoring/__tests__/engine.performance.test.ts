import { describe, expect, it } from 'vitest';
import { calculateHeatResult } from '../engine';
import type { HeatScoringInput, ScoreFact } from '../contracts';

describe('shared scoring engine performance', () => {
  it('calculates an event-sized heat repeatedly within the field budget', () => {
    const scores: ScoreFact[] = [];
    ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'].forEach((lycraColor, colorIndex) => {
      for (let wave = 1; wave <= 12; wave += 1) {
        for (let judge = 1; judge <= 5; judge += 1) {
          scores.push({
            id: `${colorIndex}-${wave}-${judge}`,
            heatId: 'performance-heat', lycraColor, waveNumber: wave, judgeStation: `J${judge}`,
            value: Math.min(10, 0.1 + ((colorIndex + wave + judge) % 99) / 10),
            timestamp: `2026-03-23T10:${String(wave).padStart(2, '0')}:00.000Z`,
            createdAt: `2026-03-23T10:${String(wave).padStart(2, '0')}:00.000Z`,
          });
        }
      }
    });
    const input: HeatScoringInput = {
      heatId: 'performance-heat', panel: { size: 5, stations: ['J1', 'J2', 'J3', 'J4', 'J5'] },
      lineup: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'].map((lycraColor) => ({ lycraColor, participant: null })),
      scores, maxWaves: 12, calculatedAt: '2026-03-23T10:59:00.000Z',
    };
    const started = performance.now();
    for (let iteration = 0; iteration < 250; iteration += 1) calculateHeatResult(input);
    const elapsedMs = performance.now() - started;
    console.info(`P2 scoring benchmark: 250 calculations, ${scores.length} facts, ${elapsedMs.toFixed(2)}ms`);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
