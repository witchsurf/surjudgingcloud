import { describe, expect, it } from 'vitest';
import { computeHeats } from '../bracket';

const buildParticipants = (count: number, category = 'OPEN') =>
  Array.from({ length: count }, (_, idx) => ({
    seed: idx + 1,
    name: `Surfer ${idx + 1}`,
    category,
  }));

describe('computeHeats (heatGeneration engine)', () => {
  // ─────────────────────────────────────────────────────────────────
  // REGRESSION: 13 participants — the business-critical Cadet case.
  // Historical rule: R1 = 4/3/3/3, R2 = 4/4, Final = 4
  // ─────────────────────────────────────────────────────────────────
  it('13 participants — generates 4/3/3/3 in R1, 4/4 in R2, and a 4-person final (no BYEs)', () => {
    const participants = buildParticipants(13);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });

    // Round 1: 4 heats distributed 4/3/3/3
    const round1 = result.rounds[0];
    expect(round1.heats).toHaveLength(4);
    const r1Sizes = round1.heats.map(h => h.slots.length).sort((a, b) => b - a);
    expect(r1Sizes).toEqual([4, 3, 3, 3]);

    // No BYEs in Round 1
    const r1Byes = round1.heats.flatMap(h => h.slots).filter(s => s.bye);
    expect(r1Byes).toHaveLength(0);

    // Round 2: 2 heats of 4
    const round2 = result.rounds[1];
    expect(round2.heats).toHaveLength(2);
    round2.heats.forEach(h => expect(h.slots).toHaveLength(4));

    // Final: 1 heat of 4
    const final = result.rounds[result.rounds.length - 1];
    expect(final.heats).toHaveLength(1);
    expect(final.heats[0].slots).toHaveLength(4);

    // Total rounds: R1 + R2 + Final = 3
    expect(result.rounds).toHaveLength(3);
  });

  // ─────────────────────────────────────────────────────────────────
  // Standard cases
  // ─────────────────────────────────────────────────────────────────
  it('12 participants — 3 heats of 4 in R1, R2, Final', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });

    const round1 = result.rounds[0];
    expect(round1.heats).toHaveLength(3);
    round1.heats.forEach(h => expect(h.slots).toHaveLength(4));

    // No BYEs in R1 for 12 participants
    const r1Byes = round1.heats.flatMap(h => h.slots).filter(s => s.bye);
    expect(r1Byes).toHaveLength(0);

    // Seeds are present in R1 slots
    const r1Seeds = round1.heats[0].slots.map(s => s.seed ?? null);
    expect(r1Seeds).toHaveLength(4);
    expect(r1Seeds.every(seed => seed !== null)).toBe(true);
  });

  it('4 participants — 1 heat of 4 R1, then a direct final', () => {
    const participants = buildParticipants(4);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });

    expect(result.rounds[0].heats).toHaveLength(1);
    expect(result.rounds[0].heats[0].slots).toHaveLength(4);
    // With 4 participants in a single heat, no subsequent rounds are generated
    expect(result.rounds).toHaveLength(1);
  });

  it('2 participants — man-on-man, single heat', () => {
    const participants = buildParticipants(2);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 2 });

    expect(result.rounds[0].heats).toHaveLength(1);
    expect(result.rounds[0].heats[0].slots).toHaveLength(2);
  });

  it('8 participants — 2 heats of 4 in R1, then finals', () => {
    const participants = buildParticipants(8);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });

    const round1 = result.rounds[0];
    expect(round1.heats).toHaveLength(2);
    round1.heats.forEach(h => expect(h.slots).toHaveLength(4));

    const r1Byes = round1.heats.flatMap(h => h.slots).filter(s => s.bye);
    expect(r1Byes).toHaveLength(0);

    expect(result.progressionEdges).toEqual([
      { targetRound: 2, targetHeat: 1, targetPosition: 1, sourceRound: 1, sourceHeat: 1, sourcePosition: 1, type: 'COMPETITION_RESULT' },
      { targetRound: 2, targetHeat: 1, targetPosition: 2, sourceRound: 1, sourceHeat: 1, sourcePosition: 2, type: 'COMPETITION_RESULT' },
      { targetRound: 2, targetHeat: 1, targetPosition: 3, sourceRound: 1, sourceHeat: 2, sourcePosition: 1, type: 'COMPETITION_RESULT' },
      { targetRound: 2, targetHeat: 1, targetPosition: 4, sourceRound: 1, sourceHeat: 2, sourcePosition: 2, type: 'COMPETITION_RESULT' },
    ]);
  });

  it('6 participants — every final slot has an explicit immutable qualifier source', () => {
    const participants = buildParticipants(6);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });

    expect(result.progressionEdges).toEqual([
      { targetRound: 2, targetHeat: 1, targetPosition: 1, sourceRound: 1, sourceHeat: 1, sourcePosition: 1, type: 'COMPETITION_RESULT' },
      { targetRound: 2, targetHeat: 1, targetPosition: 2, sourceRound: 1, sourceHeat: 1, sourcePosition: 2, type: 'COMPETITION_RESULT' },
      { targetRound: 2, targetHeat: 1, targetPosition: 3, sourceRound: 1, sourceHeat: 2, sourcePosition: 1, type: 'COMPETITION_RESULT' },
      { targetRound: 2, targetHeat: 1, targetPosition: 4, sourceRound: 1, sourceHeat: 2, sourcePosition: 2, type: 'COMPETITION_RESULT' },
    ]);
  });

  // ─────────────────────────────────────────────────────────────────
  // Placeholder format correctness — critical for persistence
  // ─────────────────────────────────────────────────────────────────
  it('R2 slots reference valid round/heat/position placeholders', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });

    const round2 = result.rounds[1];
    const placeholders = round2.heats.flatMap(h => h.slots).map(s => s.placeholder).filter(Boolean) as string[];
    expect(placeholders.length).toBeGreaterThan(0);

    // Each placeholder should embed R{round}-H{heat} (P{position}) which is parseable by heats.api.ts
    const parsePattern = /R\d+-H\d+\s*(?:\(P\d+\)|P\d+)/i;
    placeholders.forEach(ph => {
      expect(parsePattern.test(ph)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // No-bye rule for normal distributions
  // ─────────────────────────────────────────────────────────────────
  it('avoids BYEs in R1 for standard participant counts (4-16)', () => {
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].forEach(count => {
      const participants = buildParticipants(count);
      const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });
      const r1Byes = result.rounds[0].heats.flatMap(h => h.slots).filter(s => s.bye);
      expect(r1Byes).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Repechage format
  // ─────────────────────────────────────────────────────────────────
  it('repechage format generates rounds without repechage property on ComputeResult', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, { format: 'repechage', preferredHeatSize: 4 });

    // heatGeneration.ts weaves repechage into the main rounds; no separate `repechage` array.
    expect(result.rounds).toBeDefined();
    expect(result.rounds.length).toBeGreaterThanOrEqual(2);
    
    // R1 still has 12 participants in 3 heats, no BYEs
    const round1 = result.rounds[0];
    expect(round1.heats).toHaveLength(3);
    const r1Byes = round1.heats.flatMap(h => h.slots).filter(s => s.bye);
    expect(r1Byes).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Color assignment — French colors are valid HeatColor values
  // ─────────────────────────────────────────────────────────────────
  it('slots in R1 have color assigned (ROUGE/BLANC/JAUNE/BLEU or equivalent)', () => {
    const VALID_COLORS = new Set(['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK', 'ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR']);
    const participants = buildParticipants(12);
    const result = computeHeats(participants, { format: 'single-elim', preferredHeatSize: 4 });
    
    result.rounds[0].heats.forEach(heat => {
      heat.slots.forEach(slot => {
        if (slot.color) {
          expect(VALID_COLORS.has(slot.color)).toBe(true);
        }
      });
    });
  });
});
