import { useEffect, useState } from 'react';
import {
  getOfflineDiagnosticsSnapshot,
  refreshLocalRuntimeDiagnostics,
  subscribeOfflineDiagnostics,
  type OfflineDiagnosticsSnapshot,
} from '../lib/offlineOperations';

const defaultSnapshot: OfflineDiagnosticsSnapshot = {
  isBrowserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  legacyQueueCount: 0,
  scoreWalCount: 0,
  totalPending: 0,
  lastReplayAt: null,
  lastReplayStatus: null,
  lastReplayError: null,
  runtime: {
    frontendVersion: '0.0.0',
    frontendBuild: 'dev',
    expectedSchemaVersion: '',
    databaseSchemaVersion: null,
    schemaVersionMatches: null,
    lastSchemaCheckAt: null,
    schemaVersionError: null,
    hpReachable: null,
    localSupabaseReachable: null,
    lastHpCheckAt: null,
    lastHpError: null,
    realtime: [],
  },
  operations: [],
};

export function useOfflineDiagnostics(): OfflineDiagnosticsSnapshot {
  const [snapshot, setSnapshot] = useState<OfflineDiagnosticsSnapshot>(defaultSnapshot);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const snap = await getOfflineDiagnosticsSnapshot();
      if (active) setSnapshot(snap);
    };
    refresh();
    void refreshLocalRuntimeDiagnostics();
    const interval = window.setInterval(() => {
      void refreshLocalRuntimeDiagnostics();
    }, 30000);
    const unsubscribe = subscribeOfflineDiagnostics(() => {
      void refresh();
    });
    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  return snapshot;
}
