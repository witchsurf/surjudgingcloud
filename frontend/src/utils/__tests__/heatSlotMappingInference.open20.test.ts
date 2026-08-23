import { describe, expect, it } from 'vitest';
import { inferImplicitMappingsForHeat } from '../heatSlotMappingInference';

describe('OPEN 20 R1 to R2 mapping distribution', () => {
  it('uses each of the ten R1 qualifier references exactly once', () => {
    const sequence = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `r1-${i + 1}`, round: 1, heat_number: i + 1, heat_size: 4 })),
      { id: 'r2-1', round: 2, heat_number: 1, heat_size: 4 },
      { id: 'r2-2', round: 2, heat_number: 2, heat_size: 3 },
      { id: 'r2-3', round: 2, heat_number: 3, heat_size: 3 },
    ];
    const refs = sequence.slice(5).flatMap((heat) => inferImplicitMappingsForHeat(sequence, heat.id));
    const keys = refs.map((ref) => `${ref.source_round}:${ref.source_heat}:${ref.source_position}`);
    expect(keys).toHaveLength(10);
    expect(new Set(keys).size).toBe(10);
    expect(Object.fromEntries([1, 2, 3, 4, 5].map((heat) => [heat, keys.filter((key) => key.startsWith(`1:${heat}:`)).length]))).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 });
  });
});
