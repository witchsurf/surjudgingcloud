import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchParticipants: vi.fn(), upsertParticipants: vi.fn(), updateParticipant: vi.fn(), deleteParticipant: vi.fn(),
}));
vi.mock('../../api/modules/participants.api', () => api);

import { ParticipantRepository } from '../ParticipantRepository';

describe('ParticipantRepository contract', () => {
  const repository = new ParticipantRepository();
  beforeEach(() => vi.clearAllMocks());

  it('listByEvent preserves category/seed order and canonical identity', async () => {
    api.fetchParticipants.mockResolvedValue([
      { id: 1, event_id: 42, category: 'A', seed: 1, name: 'One', country: 'SN', license: 'L1' },
      { id: 2, event_id: 42, category: 'B', seed: 2, name: 'Two', country: null, license: null },
    ]);
    await expect(repository.listByEvent(42)).resolves.toEqual([
      { id: 1, eventId: 42, category: 'A', seed: 1, name: 'One', country: 'SN', license: 'L1' },
      { id: 2, eventId: 42, category: 'B', seed: 2, name: 'Two', country: null, license: null },
    ]);
  });

  it('delegates upsertMany with event/category/seed unchanged', async () => {
    const rows = [{ category: 'OPEN', seed: 3, name: 'Surfer', country: null, license: null }];
    await repository.upsertMany(42, rows);
    expect(api.upsertParticipants).toHaveBeenCalledWith(42, rows);
  });

  it('delegates update and delete unchanged', async () => {
    const patch = { category: 'OPEN', seed: 4, name: 'Updated' };
    await repository.update(7, patch);
    await repository.delete(7);
    expect(api.updateParticipant).toHaveBeenCalledWith(7, patch);
    expect(api.deleteParticipant).toHaveBeenCalledWith(7);
  });
});
