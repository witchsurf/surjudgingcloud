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
        placeholder: 'R1-H2-P1',
        source_round: 1,
        source_heat: 2,
        source_position: 1,
      },
      {
        heat_id: 'cadet_r2_h1',
        position: 3,
        placeholder: 'R1-H1-P2',
        source_round: 1,
        source_heat: 1,
        source_position: 2,
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

  it('avoids putting two qualifiers from the same source heat together when a safe snake slot exists', () => {
    const sequence = [
      { id: 'open_r1_h1', round: 1, heat_number: 1, heat_size: 4 },
      { id: 'open_r1_h2', round: 1, heat_number: 2, heat_size: 4 },
      { id: 'open_r1_h3', round: 1, heat_number: 3, heat_size: 4 },
      { id: 'open_r2_h1', round: 2, heat_number: 1, heat_size: 2 },
      { id: 'open_r2_h2', round: 2, heat_number: 2, heat_size: 2 },
      { id: 'open_r2_h3', round: 2, heat_number: 3, heat_size: 2 },
    ];

    const allRoundTwoMappings = ['open_r2_h1', 'open_r2_h2', 'open_r2_h3']
      .flatMap((heatId) => inferImplicitMappingsForHeat(sequence, heatId));

    expect(allRoundTwoMappings).toEqual([
      expect.objectContaining({ heat_id: 'open_r2_h1', source_heat: 1, source_position: 1 }),
      expect.objectContaining({ heat_id: 'open_r2_h1', source_heat: 2, source_position: 2 }),
      expect.objectContaining({ heat_id: 'open_r2_h2', source_heat: 2, source_position: 1 }),
      expect.objectContaining({ heat_id: 'open_r2_h2', source_heat: 3, source_position: 2 }),
      expect.objectContaining({ heat_id: 'open_r2_h3', source_heat: 3, source_position: 1 }),
      expect.objectContaining({ heat_id: 'open_r2_h3', source_heat: 1, source_position: 2 }),
    ]);

    const sourceHeatsByTarget = allRoundTwoMappings.reduce<Record<string, number[]>>((acc, mapping) => {
      acc[mapping.heat_id] = [...(acc[mapping.heat_id] ?? []), mapping.source_heat];
      return acc;
    }, {});

    expect(sourceHeatsByTarget.open_r2_h1).toEqual([1, 2]);
    expect(sourceHeatsByTarget.open_r2_h2).toEqual([2, 3]);
    expect(sourceHeatsByTarget.open_r2_h3).toEqual([3, 1]);
  });

  it('infers a best-second slot when an odd man-on-man round feeds a two-heat round', () => {
    const sequence = [
      { id: 'open_r2_h1', round: 2, heat_number: 1, heat_size: 2 },
      { id: 'open_r2_h2', round: 2, heat_number: 2, heat_size: 2 },
      { id: 'open_r2_h3', round: 2, heat_number: 3, heat_size: 2 },
      { id: 'open_r3_h1', round: 3, heat_number: 1, heat_size: 2 },
      { id: 'open_r3_h2', round: 3, heat_number: 2, heat_size: 2 },
    ];

    expect(inferImplicitMappingsForHeat(sequence, 'open_r3_h1')).toEqual([
      {
        heat_id: 'open_r3_h1',
        position: 1,
        placeholder: 'R2-H1-P1',
        source_round: 2,
        source_heat: 1,
        source_position: 1,
      },
      {
        heat_id: 'open_r3_h1',
        position: 2,
        placeholder: 'Meilleur 2e R2',
        source_round: null,
        source_heat: null,
        source_position: null,
      },
    ]);

    expect(inferImplicitMappingsForHeat(sequence, 'open_r3_h2')).toEqual([
      expect.objectContaining({ source_round: 2, source_heat: 2, source_position: 1 }),
      expect.objectContaining({ source_round: 2, source_heat: 3, source_position: 1 }),
    ]);
  });
});
