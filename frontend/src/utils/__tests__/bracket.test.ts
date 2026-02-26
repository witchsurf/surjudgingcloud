import { describe, expect, it } from 'vitest';
import { computeHeats } from '../bracket';

const buildParticipants = (count: number, category = 'OPEN') =>
  Array.from({ length: count }, (_, idx) => ({
    seed: idx + 1,
    name: `Surfer ${idx + 1}`,
    category,
  }));

describe('computeHeats', () => {
  it('builds single elimination bracket variant V1 for 12 surfers', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, {
      format: 'single-elim',
      variant: 'V1',
      preferredHeatSize: 4,
    });

    expect(result.rounds).toHaveLength(3);

    const round1 = result.rounds[0];
    expect(round1.heats).toHaveLength(3);
    expect(round1.heats[0].slots.map((slot) => slot.seed ?? null)).toEqual([1, 6, 7, 12]);
    expect(round1.heats[1].slots.map((slot) => slot.seed ?? null)).toEqual([2, 5, 8, 11]);
    expect(round1.heats[2].slots.map((slot) => slot.seed ?? null)).toEqual([3, 4, 9, 10]);
    expect(round1.heats[0].slots.map((slot) => slot.color)).toEqual(['RED', 'WHITE', 'YELLOW', 'BLUE']);

    const round2 = result.rounds[1];
    expect(round2.heats).toHaveLength(2);
    round2.heats.forEach((heat) => {
      expect(heat.slots).toHaveLength(3);
      expect(heat.slots.map((slot) => slot.color)).toEqual(['RED', 'WHITE', 'YELLOW']);
    });

    const final = result.rounds[2];
    expect(final.heats).toHaveLength(1);
    expect(final.heats[0].slots).toHaveLength(4);
    expect(final.heats[0].slots.map((slot) => slot.color)).toEqual(['RED', 'WHITE', 'YELLOW', 'BLUE']);
  });

  it('builds single elimination variant V2 man-on-man', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, {
      format: 'single-elim',
      variant: 'V2',
      preferredHeatSize: 4,
    });

    expect(result.rounds).toHaveLength(4);
    const round2 = result.rounds[1];
    expect(round2.heats).toHaveLength(3);
    round2.heats.forEach((heat) => {
      expect(heat.slots).toHaveLength(2);
      expect(heat.slots.map((slot) => slot.color)).toEqual(['RED', 'WHITE']);
    });

    const final = result.rounds[3];
    expect(final.name).toBe('Finale');
    expect(final.heats[0].slots).toHaveLength(2);
    expect(final.heats[0].slots.map((slot) => slot.color)).toEqual(['RED', 'WHITE']);
  });

  it('advances only winners from round 1 when preferred heat size is man-on-man', () => {
    const participants = buildParticipants(8);
    const result = computeHeats(participants, {
      format: 'single-elim',
      variant: 'V2',
      preferredHeatSize: 2,
    });

    const round1 = result.rounds[0];
    expect(round1.heats).toHaveLength(4);
    round1.heats.forEach((heat) => {
      expect(heat.slots).toHaveLength(2);
    });

    const round2 = result.rounds[1];
    const placeholders = round2.heats.flatMap((heat) =>
      heat.slots.map((slot) => slot.placeholder).filter(Boolean)
    );
    expect(placeholders).toContain('R1-H1-P1');
    expect(placeholders).toContain('R1-H2-P1');
    expect(placeholders).toContain('R1-H3-P1');
    expect(placeholders).toContain('R1-H4-P1');
    expect(placeholders.some((placeholder) => placeholder?.includes('-P2'))).toBe(false);
  });

  it('builds a hybrid bracket (R2 heats of 4, then man-on-man to final)', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, {
      format: 'single-elim',
      preferredHeatSize: 4,
      hybridPlan: {
        enabled: true,
        round2HeatSize: 4,
        round2Advance: 2,
      },
    });

    expect(result.rounds).toHaveLength(4);
    expect(result.rounds[0].heats).toHaveLength(3);
    expect(result.rounds[1].heats).toHaveLength(2);
    expect(result.rounds[1].heats[0].slots).toHaveLength(4);
    expect(result.rounds[2].heats).toHaveLength(2);
    expect(result.rounds[2].heats[0].slots).toHaveLength(2);
    expect(result.rounds[3].name).toBe('Finale');
    expect(result.rounds[3].heats[0].slots).toHaveLength(2);

    const round2Placeholders = result.rounds[1].heats.flatMap((heat) =>
      heat.slots.map((slot) => slot.placeholder).filter(Boolean)
    );
    expect(round2Placeholders.some((value) => value?.startsWith('R1-H'))).toBe(true);
  });

  it('builds repechage bracket with losers from round 1', () => {
    const participants = buildParticipants(12);
    const result = computeHeats(participants, {
      format: 'repechage',
      variant: 'V1',
      preferredHeatSize: 4,
    });

    expect(result.repechage).toBeDefined();
    const rp = result.repechage!;
    expect(rp[0].name).toBe('Repechage R1');
    const placeholders = rp[0].heats.flatMap((heat) => heat.slots.map((slot) => slot.placeholder));
    expect(placeholders).toContain('R1-H1-P3');
    expect(placeholders).toContain('R1-H1-P4');
    expect(rp[0].heats[0].slots.map((slot) => slot.color)).toEqual(['RED', 'WHITE', 'YELLOW', 'BLUE']);
  });
});
