import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    syncOffline: vi.fn(async () => { calls.push('legacy'); }),
    getOffline: vi.fn(async () => []),
    processSyncQueue: vi.fn(async () => { calls.push('wal'); }),
    recordOfflineOperation: vi.fn(),
  };
});

vi.mock('../supabase', () => ({ syncOffline: mocks.syncOffline, getOffline: mocks.getOffline }));
vi.mock('../offlineOperations', () => ({
  getLocalRuntimeSchemaReplayReadiness: vi.fn(async () => ({ ready: true })),
  recordOfflineOperation: mocks.recordOfflineOperation,
}));
vi.mock('../../stores/offlineStore', () => ({
  useOfflineStore: {
    getState: () => ({ processSyncQueue: mocks.processSyncQueue, syncError: null, setOnline: vi.fn() }),
  },
}));
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { replayOfflineQueues } from '../offlineSyncCoordinator';

describe('offline queue coordinator characterization', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('always replays the legacy queue before the score WAL', async () => {
    await replayOfflineQueues('order-test');

    expect(mocks.calls).toEqual(['legacy', 'wal']);
  });

  it('is idempotent while a replay is already in progress', async () => {
    let releaseLegacy!: () => void;
    mocks.syncOffline.mockImplementationOnce(async () => {
      mocks.calls.push('legacy');
      await new Promise<void>((resolve) => {
        releaseLegacy = resolve;
      });
    });

    const firstReplay = replayOfflineQueues('first');
    await vi.waitFor(() => expect(mocks.syncOffline).toHaveBeenCalledTimes(1));
    const duplicateReplay = replayOfflineQueues('duplicate');
    await duplicateReplay;
    releaseLegacy();
    await firstReplay;

    expect(mocks.syncOffline).toHaveBeenCalledTimes(1);
    expect(mocks.processSyncQueue).toHaveBeenCalledTimes(1);
    expect(mocks.calls).toEqual(['legacy', 'wal']);
  });
});
