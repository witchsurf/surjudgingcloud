import { useEffect, useState } from 'react';
import {
  getOfflineDiagnosticsSnapshot,
  refreshLocalRuntimeDiagnostics,
  subscribeOfflineDiagnostics,
  type OfflineDiagnosticsSnapshot,
} from '../lib/offlineOperations';

export function useOfflineDiagnostics(): OfflineDiagnosticsSnapshot {
  const [snapshot, setSnapshot] = useState<OfflineDiagnosticsSnapshot>(() => getOfflineDiagnosticsSnapshot());

  useEffect(() => {
    const refresh = () => setSnapshot(getOfflineDiagnosticsSnapshot());
    refresh();
    void refreshLocalRuntimeDiagnostics();
    const interval = window.setInterval(() => {
      void refreshLocalRuntimeDiagnostics();
    }, 30000);
    const unsubscribe = subscribeOfflineDiagnostics(refresh);
    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  return snapshot;
}
