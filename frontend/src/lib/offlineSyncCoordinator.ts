import { syncOffline } from './supabase';
import { logger } from './logger';

let replayInProgress = false;
let listenersInstalled = false;

export async function replayOfflineQueues(reason = 'manual'): Promise<void> {
  if (replayInProgress) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  replayInProgress = true;
  try {
    logger.info('OfflineSync', 'Replaying offline queues', { reason });
    // Legacy queue first: heats/config/timer must exist before score WAL replay.
    await syncOffline();
    const { useOfflineStore } = await import('../stores/offlineStore');
    await useOfflineStore.getState().processSyncQueue();
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
    });
  });

  window.addEventListener('offline', () => {
    void import('../stores/offlineStore').then(({ useOfflineStore }) => {
      useOfflineStore.getState().setOnline(false);
    });
  });

  if (navigator.onLine) {
    window.setTimeout(() => {
      void replayOfflineQueues('startup-online');
    }, 0);
  }
}
