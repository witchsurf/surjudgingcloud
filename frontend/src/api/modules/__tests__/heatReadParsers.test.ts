import { describe, expect, it } from 'vitest';
import {
  parseHeatEntryJoinedRow,
  parseHeatRow,
  parseHeatSlotMapping,
  parseHeatWithEntriesRow,
  parseLegacyLineupRow,
} from '../heatReadParsers';

describe('heat read parsers', () => {
  it('parses heat metadata without leaking extra PostgREST fields', () => {
    expect(parseHeatRow({
      id: 'heat-1', event_id: 7, competition: 'Open', division: 'OPEN', round: 1,
      heat_number: 2, heat_size: 3, status: 'active', color_order: ['ROUGE', 'BLANC'],
      unexpected_join: { raw: true },
    })).toEqual({
      id: 'heat-1', event_id: 7, competition: 'Open', division: 'OPEN', round: 1,
      heat_number: 2, heat_size: 3, status: 'active', color_order: ['ROUGE', 'BLANC'],
    });
  });

  it('accepts participant joins returned as an object or an array', () => {
    const base = { color: 'ROUGE', position: 1, participant_id: 9, seed: 2 };
    const participant = { id: 9, name: 'Awa', country: 'SN', license: null };
    expect(parseHeatEntryJoinedRow({ ...base, participant }).participant).toEqual(participant);
    expect(parseHeatEntryJoinedRow({ ...base, participant: [participant] }).participant).toEqual(participant);
  });

  it('preserves nullable legacy lineup and mapping fields', () => {
    expect(parseLegacyLineupRow({
      heat_id: 'heat-1', jersey_color: 'ROUGE', position: 1, surfer_name: null, country: null, seed: null,
    })).toEqual({
      heat_id: 'heat-1', jersey_color: 'ROUGE', position: 1, surfer_name: null, country: null, seed: null,
    });
    expect(parseHeatSlotMapping({ position: 2, placeholder: null, source_round: null })).toEqual({
      heat_id: undefined, position: 2, placeholder: null, source_round: null,
      source_heat: null, source_position: null,
    });
  });

  it('parses historical heat structures with partial nested arrays', () => {
    const parsed = parseHeatWithEntriesRow({
      id: 'heat-legacy', round: 2, heat_number: 1, heat_size: null, color_order: null,
      status: null, heat_entries: null, heat_slot_mappings: [{ position: 1, placeholder: 'R1-H1-P1' }],
    });
    expect(parsed.status).toBe('open');
    expect(parsed.heat_entries).toEqual([]);
    expect(parsed.heat_slot_mappings).toHaveLength(1);
  });
});
