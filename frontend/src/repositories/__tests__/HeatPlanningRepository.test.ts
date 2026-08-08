import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createHeatsWithEntries: vi.fn(),
  deletePlannedHeats: vi.fn(),
}));
vi.mock('../../api/modules/heats.api', () => api);

import { HeatPlanningRepository } from '../HeatPlanningRepository';

describe('HeatPlanningRepository', () => {
  const repository = new HeatPlanningRepository();

  beforeEach(() => vi.clearAllMocks());

  it('delegates generation unchanged and exposes canonical result records', async () => {
    const request = {
      eventId: 7,
      eventName: 'Open',
      category: 'Open Men',
      rounds: [{ name: 'Round 1', roundNumber: 1, heats: [{ heatNumber: 1, slots: [{ seed: 1 }] }] }],
      participantsBySeed: new Map([[1, { id: 11, eventId: 7, category: 'Open Men', seed: 1, name: 'A', country: null, license: null }]]),
      options: { overwrite: true, defaultJudges: ['J1', 'J2', 'J3'], tournamentType: 'elimination' },
    };
    api.createHeatsWithEntries.mockResolvedValue({
      heats: [{ id: 'open_open_men_r1_h1', event_id: 7, competition: 'Open', division: 'Open Men', round: 1, heat_number: 1, heat_size: 1, status: 'open', color_order: ['ROUGE'] }],
      entries: [{ heat_id: 'open_open_men_r1_h1', participant_id: 11, position: 1, seed: 1, color: 'ROUGE' }],
    });

    const result = await repository.createWithEntries(request);

    expect(api.createHeatsWithEntries).toHaveBeenCalledWith(
      7, 'Open', 'Open Men', request.rounds, request.participantsBySeed, request.options, expect.any(Function),
    );
    expect(result).toEqual({
      heats: [{ id: 'open_open_men_r1_h1', eventId: 7, competition: 'Open', division: 'Open Men', round: 1, heatNumber: 1, heatSize: 1, status: 'open', colorOrder: ['ROUGE'] }],
      entries: [{ heatId: 'open_open_men_r1_h1', participantId: 11, position: 1, seed: 1, color: 'ROUGE' }],
    });
  });

  it('delegates the explicit destructive operation and propagates errors for legacy rollback parity', async () => {
    await repository.deletePlanned({ eventId: 7, category: 'Open Men' });
    expect(api.deletePlannedHeats).toHaveBeenCalledWith(7, 'Open Men');

    const error = Object.assign(new Error('bulk failed'), { code: '42501' });
    api.createHeatsWithEntries.mockRejectedValue(error);
    await expect(repository.createWithEntries({
      eventId: 7, eventName: 'Open', category: 'Open Men', rounds: [], participantsBySeed: new Map(),
    })).rejects.toBe(error);
  });

  it('has no runtime, lifecycle, scoring, timer or qualification dependency', () => {
    const source = readFileSync(resolve(__dirname, '../HeatPlanningRepository.ts'), 'utf8');
    expect(source).not.toMatch(/HeatRepository|HeatLifecycle|Qualification|ScoreRepository|from\(['"]scores['"]\)|timer/i);
  });
});
