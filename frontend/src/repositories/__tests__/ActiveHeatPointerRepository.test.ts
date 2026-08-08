import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchActiveHeatPointer: vi.fn(), upsertActiveHeatPointer: vi.fn() }));
vi.mock('../../api/modules/heats.api', () => api);

import { ActiveHeatPointerRepository } from '../ActiveHeatPointerRepository';

const row = (podiumId: string, heatId: string) => ({
  event_id: 7, event_name: 'Open', podium_id: podiumId,
  active_heat_id: heatId, updated_at: '2026-08-06T00:00:00.000Z',
});

describe('ActiveHeatPointerRepository', () => {
  const repository = new ActiveHeatPointerRepository();
  beforeEach(() => vi.clearAllMocks());

  it('maps a nominal pointer and preserves a pointer to a closed heat', async () => {
    api.fetchActiveHeatPointer.mockResolvedValue(row('A', 'closed_heat_r1_h1'));
    await expect(repository.get({ eventId: 7, eventName: 'Open', podiumId: 'A' })).resolves.toEqual({
      eventId: 7, eventName: 'Open', podiumId: 'A', activeHeatId: 'closed_heat_r1_h1',
      updatedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(api.fetchActiveHeatPointer).toHaveBeenCalledWith(7, 'Open', 'A');
  });

  it('returns null unchanged when no pointer exists', async () => {
    api.fetchActiveHeatPointer.mockResolvedValue(null);
    await expect(repository.get({ eventId: null, podiumId: 'B' })).resolves.toBeNull();
  });

  it('keeps podium A and B reads independent', async () => {
    api.fetchActiveHeatPointer
      .mockResolvedValueOnce(row('A', 'open_r1_h1'))
      .mockResolvedValueOnce(row('B', 'open_r1_h2'));
    expect((await repository.get({ eventId: 7, podiumId: 'A' }))?.activeHeatId).toBe('open_r1_h1');
    expect((await repository.get({ eventId: 7, podiumId: 'B' }))?.activeHeatId).toBe('open_r1_h2');
    expect(api.fetchActiveHeatPointer.mock.calls).toEqual([[7, undefined, 'A'], [7, undefined, 'B']]);
  });

  it('delegates writes without changing payload or timestamp', async () => {
    const request = {
      eventId: 7, eventName: 'Open', podiumId: 'B', activeHeatId: 'open_r1_h2',
      updatedAt: '2026-08-06T00:00:00.000Z',
    };
    await repository.upsert(request);
    expect(api.upsertActiveHeatPointer).toHaveBeenCalledWith(request);
  });

  it('propagates write errors and preserves read null behavior from the adapter', async () => {
    const error = Object.assign(new Error('permission denied'), { code: '42501' });
    api.upsertActiveHeatPointer.mockRejectedValue(error);
    await expect(repository.upsert({ eventName: 'Open', activeHeatId: 'h1' })).rejects.toBe(error);
    api.fetchActiveHeatPointer.mockResolvedValue(null);
    await expect(repository.get({ eventId: Number.NaN })).resolves.toBeNull();
  });

  it('contains no lifecycle, qualification, scoring or timer dependency', () => {
    const source = readFileSync(resolve(__dirname, '../ActiveHeatPointerRepository.ts'), 'utf8');
    expect(source).not.toMatch(/HeatLifecycle|Qualification|Scor(?:e|ing)|TimerRepository|timer/i);
  });
});
