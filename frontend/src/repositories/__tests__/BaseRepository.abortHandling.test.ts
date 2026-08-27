import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({ logger }));

import { BaseRepository } from '../BaseRepository';

class TestRepository extends BaseRepository {
  constructor() {
    super('test_records', { contextName: 'StableTestRepository' });
  }

  protected override get isOnline(): boolean {
    return true;
  }

  run<T>(operation: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    return this.execute(operation, fallback, 'readSnapshot');
  }
}

describe('BaseRepository AbortError boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a browser cancellation as a warning and never executes a fallback write', async () => {
    const abort = { code: '', details: '', hint: '', message: 'AbortError: The operation was aborted.' };
    const fallback = vi.fn(() => ({ stale: true }));

    await expect(new TestRepository().run(async () => { throw abort; }, fallback)).rejects.toBe(abort);
    expect(fallback).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('StableTestRepository', 'readSnapshot - Cancelled', abort);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps real repository failures on the error channel', async () => {
    const failure = new Error('permission denied');

    await expect(new TestRepository().run(async () => { throw failure; })).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith('StableTestRepository', 'readSnapshot - Failed', failure);
  });
});
