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
  runtime: RuntimeDiagnostics;
  operations: OfflineOperationLogEntry[];
}

export type RealtimeHealthStatus = 'idle' | 'subscribed' | 'fallback_polling' | 'error' | 'closed' | 'timed_out';

export interface RealtimeDiagnosticEntry {
  key: string;
  label: string;
  status: RealtimeHealthStatus;
  hasPolling: boolean;
  updatedAt: string;
  lastActionAt?: string;
  message?: string;
}

export interface RuntimeDiagnostics {
  frontendVersion: string;
  frontendBuild: string;
  hpReachable: boolean | null;
  localSupabaseReachable: boolean | null;
  lastHpCheckAt: string | null;
  lastHpError: string | null;
  realtime: RealtimeDiagnosticEntry[];
}

const LEGACY_QUEUE_KEY = 'surfapp_offline_queue';
const SCORE_WAL_KEY = 'surfJudgingOfflineWAL';
const OPERATION_LOG_KEY = 'surfJudgingOfflineOperationLog';
const RUNTIME_DIAGNOSTICS_KEY = 'surfJudgingRuntimeDiagnostics';
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

const readRuntimeDiagnostics = (): RuntimeDiagnostics =>
  readJson<RuntimeDiagnostics>(RUNTIME_DIAGNOSTICS_KEY, {
    frontendVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) || '0.0.0',
    frontendBuild: (import.meta.env.VITE_APP_BUILD as string | undefined) || 'dev',
    hpReachable: null,
    localSupabaseReachable: null,
    lastHpCheckAt: null,
    lastHpError: null,
    realtime: [],
  });

const writeRuntimeDiagnostics = (runtime: RuntimeDiagnostics) => {
  writeJson(RUNTIME_DIAGNOSTICS_KEY, runtime);
  emitDiagnosticsUpdated();
};

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
    runtime: readRuntimeDiagnostics(),
    operations,
  };
}

export function reportRealtimeDiagnostic(input: Omit<RealtimeDiagnosticEntry, 'updatedAt'>) {
  const runtime = readRuntimeDiagnostics();
  const entry: RealtimeDiagnosticEntry = {
    ...input,
    updatedAt: nowIso(),
  };
  const nextRealtime = [
    entry,
    ...runtime.realtime.filter((item) => item.key !== entry.key),
  ].slice(0, 40);
  writeRuntimeDiagnostics({ ...runtime, realtime: nextRealtime });
}

export async function refreshLocalRuntimeDiagnostics(): Promise<void> {
  if (typeof window === 'undefined') return;

  const runtime = readRuntimeDiagnostics();
  const origin = window.location.origin;
  const hostname = window.location.hostname;
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.') ||
    hostname.startsWith('192.168.');

  if (!isLocalHost) {
    writeRuntimeDiagnostics({
      ...runtime,
      hpReachable: null,
      localSupabaseReachable: null,
      lastHpCheckAt: nowIso(),
      lastHpError: null,
    });
    return;
  }

  const supabaseUrl = `http://${hostname}:8000/rest/v1/events?select=id&limit=1`;
  let hpReachable = false;
  let localSupabaseReachable = false;
  let lastHpError: string | null = null;

  try {
    const response = await fetch(origin, { method: 'HEAD', cache: 'no-store' });
    hpReachable = response.ok;
  } catch (error) {
    lastHpError = toErrorMessage(error);
  }

  try {
    const response = await fetch(supabaseUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY_LAN as string | undefined)
          || (import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL as string | undefined)
          || '',
      },
    });
    localSupabaseReachable = response.ok;
    if (!response.ok) {
      lastHpError = `Supabase local HTTP ${response.status}`;
    }
  } catch (error) {
    lastHpError = toErrorMessage(error);
  }

  writeRuntimeDiagnostics({
    ...runtime,
    hpReachable,
    localSupabaseReachable,
    lastHpCheckAt: nowIso(),
    lastHpError,
  });
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
