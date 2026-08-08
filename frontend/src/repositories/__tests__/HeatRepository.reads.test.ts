import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchAllEventHeats: vi.fn(),
  fetchCategoryHeats: vi.fn(),
  fetchHeatEntriesWithParticipants: vi.fn(),
  fetchHeatEntriesWithParticipantsBatch: vi.fn(),
  fetchHeatMetadata: vi.fn(),
  fetchHeatSlotMappings: vi.fn(),
  fetchHeatSlotMappingsBatch: vi.fn(),
  fetchOrderedHeatSequence: vi.fn(),
}));
vi.mock('../../api/modules/heats.api', () => api);

import { HeatRepository } from '../HeatRepository';

const entry = (name = 'Awa') => ({
  color: 'ROUGE', position: 1, participant_id: 12, seed: 1,
  participant: { name, country: 'SN', license: 'L-12' },
});

describe('HeatRepository read contract', () => {
  const repository = new HeatRepository();
  beforeEach(() => vi.clearAllMocks());

  it('maps metadata and its lineup to the canonical contract', async () => {
    api.fetchHeatMetadata.mockResolvedValue({
      id: 'heat-1', event_id: 7, competition: 'Open', division: 'OPEN', round: 1,
      heat_number: 1, heat_size: 3, status: 'active', color_order: ['ROUGE', 'BLANC', 'JAUNE'],
    });
    api.fetchHeatEntriesWithParticipants.mockResolvedValue([entry()]);
    const heat = await repository.getById('heat-1');
    expect(heat).toMatchObject({ id: 'heat-1', eventId: 7, heatNumber: 1 });
    expect(heat?.slots[0]).toEqual({
      position: 1, color: 'ROUGE', seed: 1, participantId: 12,
      participant: { id: 12, name: 'Awa', country: 'SN', license: 'L-12' },
    });
  });

  it('preserves sequence order returned by the ordered read', async () => {
    api.fetchOrderedHeatSequence.mockResolvedValue([
      { id: 'h1', round: 1, heat_number: 1, status: 'closed', heat_size: 3, color_order: ['ROUGE'] },
      { id: 'h2', round: 1, heat_number: 2, status: 'open', heat_size: 3, color_order: ['ROUGE'] },
    ]);
    const sequence = await repository.listSequence(7, 'OPEN');
    expect(sequence.map((heat) => heat.id)).toEqual(['h1', 'h2']);
  });

  it('keeps lycra identity when the displayed participant changes', async () => {
    api.fetchHeatEntriesWithParticipants
      .mockResolvedValueOnce([entry('Awa')])
      .mockResolvedValueOnce([entry('Moussa')]);
    expect((await repository.listEntries('heat-1'))[0]).toMatchObject({ color: 'ROUGE', participant: { name: 'Awa' } });
    expect((await repository.listEntries('heat-1'))[0]).toMatchObject({ color: 'ROUGE', participant: { name: 'Moussa' } });
  });

  it('keeps the historical lineup fallback shape while exposing canonical fields', async () => {
    api.fetchHeatEntriesWithParticipants.mockResolvedValue([{
      color: 'JAUNE', position: 3, participant_id: null, seed: null,
      participant: { name: 'Qualifié R1-H2', country: null, license: null },
    }]);
    await expect(repository.listEntries('heat-legacy')).resolves.toEqual([{
      position: 3, color: 'JAUNE', seed: null, participantId: null,
      participant: { id: null, name: 'Qualifié R1-H2', country: null, license: null },
    }]);
  });

  it('uses one batch read and does not fall back to per-heat reads', async () => {
    api.fetchHeatEntriesWithParticipantsBatch.mockResolvedValue(new Map([
      ['h1', [entry('Awa')]], ['h2', [{ ...entry('Moussa'), color: 'BLANC', position: 2 }]],
    ]));
    const rows = await repository.listEntriesBatch(['h1', 'h2']);
    expect(api.fetchHeatEntriesWithParticipantsBatch).toHaveBeenCalledTimes(1);
    expect(api.fetchHeatEntriesWithParticipants).not.toHaveBeenCalled();
    expect(rows.get('h2')?.[0]).toMatchObject({ color: 'BLANC', participant: { name: 'Moussa' } });
  });

  it('maps simple and batch slot mappings without N+1', async () => {
    const raw = { heat_id: 'h1', position: 1, placeholder: 'R1-H1-P1', source_round: 1, source_heat: 1, source_position: 1 };
    api.fetchHeatSlotMappings.mockResolvedValue([raw]);
    api.fetchHeatSlotMappingsBatch.mockResolvedValue(new Map([['h1', [raw]]]));
    await expect(repository.listSlotMappings('h1')).resolves.toEqual([{
      heatId: 'h1', position: 1, placeholder: 'R1-H1-P1', sourceRound: 1, sourceHeat: 1, sourcePosition: 1,
    }]);
    const batch = await repository.listSlotMappingsBatch(['h1']);
    expect(api.fetchHeatSlotMappingsBatch).toHaveBeenCalledTimes(1);
    expect(api.fetchHeatSlotMappings).toHaveBeenCalledTimes(1);
    expect(batch.get('h1')).toHaveLength(1);
  });

  it('maps all-event rounds from the existing result without category re-reads', async () => {
    const rounds = [{ roundNumber: 1, name: 'Round 1', heats: [{ heatId: 'h1', heatNumber: 1, slots: [] }] }];
    api.fetchAllEventHeats.mockResolvedValue({ OPEN: rounds });
    await expect(repository.listAllEventRounds(7)).resolves.toEqual({
      OPEN: [{ roundNumber: 1, roundName: 'Round 1', heats: [{ heatId: 'h1', heatNumber: 1, slots: [] }] }],
    });
    expect(api.fetchCategoryHeats).not.toHaveBeenCalled();
  });
});
