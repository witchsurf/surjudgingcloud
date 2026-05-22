export type OfflineQueueName = 'legacy' | 'score_wal' | 'coordinator';
export type OfflineOperationStatus = 'queued' | 'replaying' | 'synced' | 'failed' | 'skipped';

export interface OfflineOperationLogEntry {
  id: string;
  queue: OfflineQueueName;
  status: OfflineOperationStatus;
  kind: string;
  target?: string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  metadata?: Record<string, unknown>;
}

export interface OfflineDiagnosticsSnapshot {
  isBrowserOnline: boolean;
  legacyQueueCount: number;
  scoreWalCount: number;
  totalPending: number;
  lastReplayAt: string | null;
  lastReplayStatus: OfflineOperationStatus | null;
  lastReplayError: string | null;
  operations: OfflineOperationLogEntry[];
}

const LEGACY_QUEUE_KEY = 'surfapp_offline_queue';
const SCORE_WAL_KEY = 'surfJudgingOfflineWAL';
const OPERATION_LOG_KEY = 'surfJudgingOfflineOperationLog';
const OPERATION_EVENT = 'surfjudging:offline-diagnostics-updated';
const MAX_OPERATION_LOG_ENTRIES = 120;

const nowIso = () => new Date().toISOString();

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const readJson = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Diagnostics must never block field scoring.
  }
};

const emitDiagnosticsUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPERATION_EVENT));
};

const toErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const candidate = error as { message?: string; code?: string; details?: string };
    return [candidate.code, candidate.message, candidate.details].filter(Boolean).join(' | ') || JSON.stringify(error);
  }
  return String(error);
};

const readOperationLog = (): OfflineOperationLogEntry[] =>
  readJson<OfflineOperationLogEntry[]>(OPERATION_LOG_KEY, []);

export function recordOfflineOperation(input: {
  id?: string;
  queue: OfflineQueueName;
  status: OfflineOperationStatus;
  kind: string;
  target?: string;
  message?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}): OfflineOperationLogEntry {
  const timestamp = nowIso();
  const id = input.id || makeId();
  const log = readOperationLog();
  const existingIndex = log.findIndex((entry) => entry.id === id);
  const previous = existingIndex >= 0 ? log[existingIndex] : null;
  const next: OfflineOperationLogEntry = {
    id,
    queue: input.queue,
    status: input.status,
    kind: input.kind,
    target: input.target,
    message: input.message,
    error: toErrorMessage(input.error) || undefined,
    createdAt: previous?.createdAt || timestamp,
    updatedAt: timestamp,
    attempts: previous ? previous.attempts + (input.status === 'replaying' ? 1 : 0) : (input.status === 'replaying' ? 1 : 0),
    metadata: input.metadata,
  };

  const withoutExisting = existingIndex >= 0
    ? log.filter((entry) => entry.id !== id)
    : log;
  const nextLog = [next, ...withoutExisting].slice(0, MAX_OPERATION_LOG_ENTRIES);
  writeJson(OPERATION_LOG_KEY, nextLog);
  emitDiagnosticsUpdated();
  return next;
}

export function createOfflineOperationId(): string {
  return makeId();
}

export function getOfflineDiagnosticsSnapshot(): OfflineDiagnosticsSnapshot {
  const legacyQueue = readJson<unknown[]>(LEGACY_QUEUE_KEY, []);
  const walPersisted = readJson<{ state?: { mutations?: unknown[] } }>(SCORE_WAL_KEY, {});
  const scoreWalCount = Array.isArray(walPersisted?.state?.mutations)
    ? walPersisted.state.mutations.length
    : 0;
  const operations = readOperationLog();
  const lastReplay = operations.find((entry) => entry.queue === 'coordinator');

  return {
    isBrowserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    legacyQueueCount: Array.isArray(legacyQueue) ? legacyQueue.length : 0,
    scoreWalCount,
    totalPending: (Array.isArray(legacyQueue) ? legacyQueue.length : 0) + scoreWalCount,
    lastReplayAt: lastReplay?.updatedAt || null,
    lastReplayStatus: lastReplay?.status || null,
    lastReplayError: lastReplay?.error || null,
    operations,
  };
}

export function subscribeOfflineDiagnostics(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(OPERATION_EVENT, listener);
  window.addEventListener('storage', listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener(OPERATION_EVENT, listener);
    window.removeEventListener('storage', listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}
