import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createWithEntries } = vi.hoisted(() => ({ createWithEntries: vi.fn() }));
vi.mock('../../repositories/HeatPlanningRepository', () => ({
  heatPlanningRepository: { createWithEntries },
}));

import { persistPlanningImportSafely } from '../persistPlanningImportSafely';

const input = {
  eventId: '7', source: 'xlsx' as const, sourceName: 'Competition X.xlsx',
  participants: [
    { category: 'OPEN', seed: 1, name: 'A', country: 'SN', license: null, sourceRow: 2 },
    { category: 'OPEN', seed: 2, name: 'B', country: null, license: '002', sourceRow: 3 },
    { category: 'CADET', seed: 1, name: 'C', country: null, license: null, sourceRow: 4 },
  ],
};
const preview = {
  rounds: [{ name: 'Round 1', roundNumber: 1, heats: [{ heatNumber: 1, slots: [{ seed: 1 }, { seed: 2 }] }] }],
};

describe('persistPlanningImportSafely readiness service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps canonical participants and delegates only to the safe HeatPlanningRepository facade', async () => {
    await persistPlanningImportSafely({
      input, preview, eventId: 7, eventName: 'Competition X', category: 'OPEN',
      format: 'single-elim', overwrite: true,
    });
    expect(createWithEntries).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 7, eventName: 'Competition X', category: 'OPEN',
      participantsBySeed: expect.any(Map),
      options: expect.objectContaining({ overwrite: true, tournamentType: 'elimination' }),
    }));
    const request = createWithEntries.mock.calls[0][0];
    expect([...request.participantsBySeed.values()].map((participant) => participant.name)).toEqual(['A', 'B']);
  });

  it('rejects invalid input before reaching persistence', async () => {
    await expect(persistPlanningImportSafely({
      input, preview, eventId: 7, eventName: 'Competition X', category: 'MISSING',
      format: 'single-elim', overwrite: false,
    })).rejects.toThrow('Catégorie absente');
    expect(createWithEntries).not.toHaveBeenCalled();
  });
});
