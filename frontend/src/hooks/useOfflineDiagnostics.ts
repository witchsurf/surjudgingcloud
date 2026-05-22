import { useEffect, useState } from 'react';
import {
  getOfflineDiagnosticsSnapshot,
  subscribeOfflineDiagnostics,
  type OfflineDiagnosticsSnapshot,
} from '../lib/offlineOperations';

export function useOfflineDiagnostics(): OfflineDiagnosticsSnapshot {
  const [snapshot, setSnapshot] = useState<OfflineDiagnosticsSnapshot>(() => getOfflineDiagnosticsSnapshot());

  useEffect(() => {
    const refresh = () => setSnapshot(getOfflineDiagnosticsSnapshot());
    refresh();
    return subscribeOfflineDiagnostics(refresh);
  }, []);

  return snapshot;
}
