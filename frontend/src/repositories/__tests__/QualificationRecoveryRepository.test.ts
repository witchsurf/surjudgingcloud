import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  propagateQualifiersForSourceHeat: vi.fn(),
  rebuildDivisionQualifiersFromScores: vi.fn(),
}));
vi.mock('../../api/modules/heats.api', () => api);

import { QualificationRecoveryRepository } from '../QualificationRecoveryRepository';

describe('QualificationRecoveryRepository', () => {
  const repository = new QualificationRecoveryRepository();
  beforeEach(() => vi.clearAllMocks());

  it('delegates nominal propagation and preserves its counter', async () => {
    api.propagateQualifiersForSourceHeat.mockResolvedValue(4);
    await expect(repository.propagateSourceHeat('event_open_r1_h1')).resolves.toBe(4);
    expect(api.propagateQualifiersForSourceHeat).toHaveBeenCalledWith('event_open_r1_h1');
  });

  it('delegates nominal rebuild and preserves its counter', async () => {
    api.rebuildDivisionQualifiersFromScores.mockResolvedValue(7);
    await expect(repository.rebuildDivision(12, 'ONDINE OPEN')).resolves.toBe(7);
    expect(api.rebuildDivisionQualifiersFromScores).toHaveBeenCalledWith(12, 'ONDINE OPEN');
  });

  it.each([
    ['propagation', () => repository.propagateSourceHeat('bad-heat'), 'propagateQualifiersForSourceHeat'],
    ['rebuild', () => repository.rebuildDivision(-1, ''), 'rebuildDivisionQualifiersFromScores'],
  ] as const)('propagates %s adapter errors unchanged', async (_label, invoke, method) => {
    const error = Object.assign(new Error('invalid recovery input'), { code: '23503' });
    api[method].mockRejectedValue(error);
    await expect(invoke()).rejects.toBe(error);
  });

  it('contains no scoring calculation or score write dependency', () => {
    const source = readFileSync(resolve(__dirname, '../QualificationRecoveryRepository.ts'), 'utf8');
    expect(source).not.toMatch(/calculate|ScoreRepository|from\(['"]scores['"]\)|\.from\(['"]scores['"]\)/);
  });
});
