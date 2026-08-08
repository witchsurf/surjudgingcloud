import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchActiveJudges: vi.fn(), fetchJudgeById: vi.fn(), validateJudgeCode: vi.fn(), createJudge: vi.fn(),
  updateJudge: vi.fn(), deactivateJudge: vi.fn(), updateJudgeName: vi.fn(),
}));
vi.mock('../../api/modules/judges.api', () => api);

import { JudgeRepository } from '../JudgeRepository';

const raw = {
  id: 'judge-1', name: 'Judge One', personal_code: '1234', email: null, phone: null,
  certification_level: 'A', federation: 'FSS', active: true, created_at: '2026-08-05T10:00:00.000Z',
};
const canonical = {
  id: 'judge-1', name: 'Judge One', personalCode: '1234', email: null, phone: null,
  certificationLevel: 'A', federation: 'FSS', active: true, createdAt: '2026-08-05T10:00:00.000Z',
};

describe('JudgeRepository contract', () => {
  const repository = new JudgeRepository();
  beforeEach(() => vi.clearAllMocks());

  it('maps listActive, getById and validateCode', async () => {
    api.fetchActiveJudges.mockResolvedValue([raw]);
    api.fetchJudgeById.mockResolvedValue(raw);
    api.validateJudgeCode.mockResolvedValue(raw);
    await expect(repository.listActive()).resolves.toEqual([canonical]);
    await expect(repository.getById('judge-1')).resolves.toEqual(canonical);
    await expect(repository.validateCode('judge-1', '1234')).resolves.toEqual(canonical);
  });

  it('maps create and update without changing API behavior', async () => {
    api.createJudge.mockResolvedValue(raw);
    api.updateJudge.mockResolvedValue(raw);
    await expect(repository.create({ name: 'Judge One', personalCode: '1234' })).resolves.toEqual(canonical);
    expect(api.createJudge).toHaveBeenCalledWith(expect.objectContaining({ personal_code: '1234' }));
    await expect(repository.update('judge-1', { certificationLevel: 'A' })).resolves.toEqual(canonical);
    expect(api.updateJudge).toHaveBeenCalledWith('judge-1', expect.objectContaining({ certification_level: 'A' }));
  });

  it('delegates deactivate and updateEventDisplayName', async () => {
    await repository.deactivate('judge-1');
    await repository.updateEventDisplayName(42, 'judge-1', 'Display');
    expect(api.deactivateJudge).toHaveBeenCalledWith('judge-1');
    expect(api.updateJudgeName).toHaveBeenCalledWith(42, 'judge-1', 'Display');
  });
});
