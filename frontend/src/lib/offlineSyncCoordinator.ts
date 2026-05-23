import { getOffline, syncOffline } from './supabase';
import { logger } from './logger';
import { getLocalRuntimeSchemaReplayReadiness, recordOfflineOperation } from './offlineOperations';

let replayInProgress = false;
let listenersInstalled = false;

export async function replayOfflineQueues(reason = 'manual'): Promise<void> {
  if (replayInProgress) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    recordOfflineOperation({
      id: `coordinator-${reason}`,
      queue: 'coordinator',
      status: 'skipped',
      kind: 'replay_queues',
      message: 'Navigateur hors ligne',
    });
    return;
  }

  replayInProgress = true;
  const operationId = `coordinator-${reason}`;
  try {
    const schemaReadiness = await getLocalRuntimeSchemaReplayReadiness();
    if (!schemaReadiness.ready) {
      recordOfflineOperation({
        id: operationId,
        queue: 'coordinator',
        status: 'skipped',
        kind: 'replay_queues',
        message: schemaReadiness.reason || reason,
      });
      logger.warn('OfflineSync', 'Replay skipped until local schema is aligned', {
        reason,
        schemaReason: schemaReadiness.reason,
      });
      return;
    }

    logger.info('OfflineSync', 'Replaying offline queues', { reason });
    recordOfflineOperation({
      id: operationId,
      queue: 'coordinator',
      status: 'replaying',
      kind: 'replay_queues',
      message: reason,
    });
    // Legacy queue first: heats/config/timer must exist before score WAL replay.
    await syncOffline();
    const { useOfflineStore } = await import('../stores/offlineStore');
    await useOfflineStore.getState().processSyncQueue();
    const legacyPending = (await getOffline()).length;
    const scoreWalState = useOfflineStore.getState();
    if (legacyPending > 0 || scoreWalState.syncError) {
      throw new Error([
        legacyPending > 0 ? `${legacyPending} action(s) legacy encore en attente` : '',
        scoreWalState.syncError ? `WAL scores: ${scoreWalState.syncError}` : '',
      ].filter(Boolean).join(' | '));
    }
    recordOfflineOperation({
      id: operationId,
      queue: 'coordinator',
      status: 'synced',
      kind: 'replay_queues',
      message: reason,
    });
  } catch (error) {
    recordOfflineOperation({
      id: operationId,
      queue: 'coordinator',
      status: 'failed',
      kind: 'replay_queues',
      message: reason,
      error,
    });
    throw error;
  } finally {
    replayInProgress = false;
  }
}

export function installOfflineSyncCoordinator(): void {
  if (typeof window === 'undefined' || listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener('online', () => {
    void import('../stores/offlineStore').then(({ useOfflineStore }) => {
      useOfflineStore.getState().setOnline(true);
      return replayOfflineQueues('browser-online');
    }).catch((error) => {
      logger.error('OfflineSync', 'Replay after browser-online failed', error);
    });
  });

  window.addEventListener('offline', () => {
    void import('../stores/offlineStore').then(({ useOfflineStore }) => {
      useOfflineStore.getState().setOnline(false);
    });
  });

  if (navigator.onLine) {
    window.setTimeout(() => {
      void replayOfflineQueues('startup-online').catch((error) => {
        logger.error('OfflineSync', 'Startup replay failed', error);
      });
    }, 0);
  }
}
