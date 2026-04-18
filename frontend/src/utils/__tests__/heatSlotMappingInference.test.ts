import { describe, expect, it } from 'vitest';
import { inferImplicitMappingsForHeat } from '../heatSlotMappingInference';

describe('inferImplicitMappingsForHeat', () => {
  it('reconstructs the cadet round-1 to round-2 mapping when persisted mappings are missing', () => {
    const sequence = [
      { id: 'cadet_r1_h1', round: 1, heat_number: 1, heat_size: 3 },
      { id: 'cadet_r1_h2', round: 1, heat_number: 2, heat_size: 3 },
      { id: 'cadet_r2_h1', round: 2, heat_number: 1, heat_size: 4 },
    ];

    expect(inferImplicitMappingsForHeat(sequence, 'cadet_r2_h1')).toEqual([
      {
        heat_id: 'cadet_r2_h1',
        position: 1,
        placeholder: 'R1-H1-P1',
        source_round: 1,
        source_heat: 1,
        source_position: 1,
      },
      {
        heat_id: 'cadet_r2_h1',
        position: 2,
        placeholder: 'R1-H1-P2',
        source_round: 1,
        source_heat: 1,
        source_position: 2,
      },
      {
        heat_id: 'cadet_r2_h1',
        position: 3,
        placeholder: 'R1-H2-P1',
        source_round: 1,
        source_heat: 2,
        source_position: 1,
      },
      {
        heat_id: 'cadet_r2_h1',
        position: 4,
        placeholder: 'R1-H2-P2',
        source_round: 1,
        source_heat: 2,
        source_position: 2,
      },
    ]);
  });
});
