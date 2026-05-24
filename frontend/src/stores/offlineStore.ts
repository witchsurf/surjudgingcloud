/**
 * Offline Store (Zustand)
 * 
 * Manages client network status and coordinates the Write-Ahead Log (WAL) transaction journal
 * for offline-first resilience. Guarantees FIFO execution order upon network reconnection
 * to prevent database integrity and foreign key constraints issues.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { logger } from '../lib/logger';
import { describeScoreWalMutation, recordOfflineOperation } from '../lib/offlineOperations';
import { createIDBZustandStorage } from '../lib/idbOfflineStore';

export interface OfflineMutation {
    id: string;
    timestamp: string;
    table: 'scores' | 'score_overrides';
    action: 'insert' | 'update';
    payload: any;
}

interface OfflineStore {
    // Network status
    isOnline: boolean;
    isSyncing: boolean;
    syncError: string | null;

    // WAL Queue
    mutations: OfflineMutation[];

    // Actions
    setOnline: (online: boolean) => void;
    registerMutation: (table: 'scores' | 'score_overrides', action: 'insert' | 'update', payload: any) => void;
    clearMutations: () => void;
    processSyncQueue: () => Promise<void>;
}

export const useOfflineStore = create<OfflineStore>()(
    persist(
        (set, get) => {
            // Background sync execution (debounced / safe dynamic executor)
            let syncInProgress = false;

            const executeSync = async () => {
                if (syncInProgress) return;
                const { mutations, isOnline } = get();
                if (!isOnline || mutations.length === 0) return;

                syncInProgress = true;
                set({ isSyncing: true, syncError: null });

                logger.info('OfflineStore', `Starting WAL sync replay of ${mutations.length} mutations...`);

                try {
                    const { replayScoreWalMutation } = await import('./scoreWalExecutor');

                    // Clone the current mutations array to process them in strict FIFO order
                    const queue = [...mutations];

                    for (const mutation of queue) {
                        logger.info('OfflineStore', `Replaying mutation ${mutation.id} on table '${mutation.table}'...`);
                        const operation = describeScoreWalMutation(mutation);
                        recordOfflineOperation({
                            id: mutation.id,
                            queue: 'score_wal',
                            status: 'replaying',
                            kind: operation.kind,
                            target: operation.target,
                            metadata: operation.metadata,
                        });

                        await replayScoreWalMutation(mutation);

                        // Remove this successfully replayed mutation from store state
                        set((state) => ({
                            mutations: state.mutations.filter((m) => m.id !== mutation.id),
                        }));
                        recordOfflineOperation({
                            id: mutation.id,
                            queue: 'score_wal',
                            status: 'synced',
                            kind: operation.kind,
                            target: operation.target,
                            metadata: operation.metadata,
                        });
                    }

                    logger.info('OfflineStore', 'WAL sync replay completed successfully.');
                    set({ isSyncing: false, syncError: null });
                } catch (error: any) {
                    const errorMsg = error?.message || 'Unknown synchronization error';
                    logger.error('OfflineStore', 'WAL sync replay failed', error);
                    const failedMutation = get().mutations[0];
                    if (failedMutation) {
                        const operation = describeScoreWalMutation(failedMutation);
                        recordOfflineOperation({
                            id: failedMutation.id,
                            queue: 'score_wal',
                            status: 'failed',
                            kind: operation.kind,
                            target: operation.target,
                            error,
                            metadata: operation.metadata,
                        });
                    }
                    set({ isSyncing: false, syncError: errorMsg });
                } finally {
                    syncInProgress = false;
                }
            };

            return {
                // Initial State
                isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
                isSyncing: false,
                syncError: null,
                mutations: [],

                // Set Network status manually. Queue replay is coordinated by offlineSyncCoordinator.
                setOnline: (online: boolean) => {
                    set({ isOnline: online });
                },

                // Register a new mutation sequentially to the WAL
                registerMutation: (table, action, payload) => {
                    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto 
                        ? crypto.randomUUID() 
                        : Math.random().toString(36).substring(2, 15);

                    const mutation: OfflineMutation = {
                        id,
                        timestamp: new Date().toISOString(),
                        table,
                        action,
                        payload,
                    };

                    set((state) => ({
                        mutations: [...state.mutations, mutation],
                    }));

                    logger.debug('OfflineStore', `Mutation registered in WAL: ${table} (${action})`, { id });
                    const operation = describeScoreWalMutation(mutation);
                    recordOfflineOperation({
                        id,
                        queue: 'score_wal',
                        status: 'queued',
                        kind: operation.kind,
                        target: operation.target,
                        metadata: operation.metadata,
                    });
                },

                // Clear queue manually in case of forced overrides/resets
                clearMutations: () => {
                    set({ mutations: [] });
                    logger.warn('OfflineStore', 'Offline mutations queue cleared manually.');
                },

                // Public method to trigger sync manually
                processSyncQueue: async () => {
                    await executeSync();
                },
            };
        },
        {
            name: 'surfJudgingOfflineWAL',
            storage: createJSONStorage(() => createIDBZustandStorage()),
            partialize: (state) => ({ mutations: state.mutations }), // Only persist mutations list
        }
    )
);
