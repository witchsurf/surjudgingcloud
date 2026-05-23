import { legacyGetAll, walGetAll } from './idbOfflineStore';
import { isLocalNetworkHost } from './networkDetection';

export type OfflineQueueName = 'legacy' | 'score_wal' | 'coordinator';
export type OfflineOperationStatus = 'queued' | 'replaying' | 'synced' | 'failed' | 'skipped';
export type FieldOperationIntent =
  | 'submit_score'
  | 'submit_interference'
  | 'override_score'
  | 'close_heat'
  | 'switch_heat'
  | 'save_heat_config'
  | 'timer_update'
  | 'replay_queues'
  | 'legacy_mutation';

export interface FieldOperationTrace {
  table?: string;
  action?: string;
  heatId?: string;
  eventId?: number | string | null;
  surfer?: string;
  waveNumber?: number | string | null;
  judgeStation?: string;
  status?: string;
}

export interface OfflineOperationLogEntry {
  id: string;
  intent: FieldOperationIntent;
  queue: OfflineQueueName;
  status: OfflineOperationStatus;
  kind: string;
  target?: string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  trace?: FieldOperationTrace;
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
  expectedSchemaVersion: string;
  databaseSchemaVersion: string | null;
  schemaVersionMatches: boolean | null;
  lastSchemaCheckAt: string | null;
  schemaVersionError: string | null;
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

const normalizeStatus = (value: unknown) => String(value ?? '').trim().toLowerCase();

const readPayloadValue = (payload: Record<string, unknown>, key: string): unknown => {
  if (key in payload) return payload[key];
  const data = payload.data;
  if (data && typeof data === 'object' && key in data) {
    return (data as Record<string, unknown>)[key];
  }
  const rows = payload.rows;
  if (Array.isArray(rows)) {
    const first = rows[0];
    if (first && typeof first === 'object' && key in first) {
      return (first as Record<string, unknown>)[key];
    }
  } else if (rows && typeof rows === 'object' && key in rows) {
    return (rows as Record<string, unknown>)[key];
  }
  return undefined;
};

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

export function inferFieldOperationIntent(input: {
  kind: string;
  metadata?: Record<string, unknown>;
}): FieldOperationIntent {
  const kind = input.kind.toLowerCase();
  const table = String(input.metadata?.table || kind.split('.')[0] || '').toLowerCase();
  const action = String(input.metadata?.action || kind.split('.')[1] || '').toLowerCase();
  const status = normalizeStatus(input.metadata?.status);

  if (kind === 'replay_queues' || table === 'coordinator') return 'replay_queues';
  if (table === 'scores' && (action === 'insert' || action === 'upsert')) return 'submit_score';
  if (table === 'interference_calls') return 'submit_interference';
  if (table === 'score_overrides') return 'override_score';
  if (table === 'active_heat_pointer') return 'switch_heat';
  if (table === 'heat_configs' || table === 'heat_judge_assignments' || table === '__heat_config_repair__') {
    return 'save_heat_config';
  }
  if (table === 'heats' && status === 'closed') return 'close_heat';
  if (table === 'heat_realtime_config' && status === 'closed') return 'close_heat';
  if (table === 'heats' && ['running', 'waiting', 'open'].includes(status)) return 'switch_heat';
  if (table === 'heat_realtime_config' && ['running', 'waiting'].includes(status)) return 'timer_update';
  if (table === 'heat_realtime_config') return 'timer_update';
  return 'legacy_mutation';
}

export function buildFieldOperationTrace(input: {
  kind: string;
  target?: string;
  metadata?: Record<string, unknown>;
}): FieldOperationTrace {
  const metadata = input.metadata || {};
  const table = firstString(metadata.table, input.kind.split('.')[0]);
  const action = firstString(metadata.action, input.kind.split('.')[1]);
  const trace: FieldOperationTrace = {
    table,
    action,
    heatId: firstString(metadata.heat_id, metadata.heatId, input.target),
    eventId: (metadata.event_id ?? metadata.eventId ?? null) as number | string | null,
    surfer: firstString(metadata.surfer),
    waveNumber: (metadata.wave_number ?? metadata.waveNumber ?? null) as number | string | null,
    judgeStation: firstString(metadata.judge_station, metadata.judgeStation, metadata.judge_id, metadata.judgeId),
    status: firstString(metadata.status),
  };

  return Object.fromEntries(
    Object.entries(trace).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as FieldOperationTrace;
}

export function describeLegacyOfflineEntry(entry: {
  table: string;
  action: string;
  payload: Record<string, unknown>;
}): { kind: string; target?: string; metadata: Record<string, unknown> } {
  const payload = entry.payload || {};
  const data = typeof payload.data === 'object' && payload.data !== null
    ? payload.data as Record<string, unknown>
    : {};
  const status = readPayloadValue(payload, 'status');
  const heatId = firstString(
    readPayloadValue(payload, 'heat_id'),
    data.heat_id,
    payload.id,
    readPayloadValue(payload, 'active_heat_id'),
  );
  const target = firstString(heatId, readPayloadValue(payload, 'id'));
  const metadata: Record<string, unknown> = {
    table: entry.table,
    action: entry.action,
    heat_id: heatId,
    event_id: readPayloadValue(payload, 'event_id'),
    status,
  };

  return {
    kind: `${entry.table}.${entry.action}`,
    target,
    metadata: Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
  };
}

export function describeScoreWalMutation(input: {
  table: string;
  action: string;
  payload: Record<string, unknown>;
}): { kind: string; target?: string; metadata: Record<string, unknown> } {
  const payload = input.payload || {};
  const metadata = {
    table: input.table,
    action: input.action,
    heat_id: payload.heat_id,
    event_id: payload.event_id,
    surfer: payload.surfer,
    wave_number: payload.wave_number,
    judge_station: payload.judge_station || payload.judge_id,
    status: payload.status,
  };

  return {
    kind: `${input.table}.${input.action}`,
    target: firstString(payload.heat_id),
    metadata: Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
  };
}

const readOperationLog = (): OfflineOperationLogEntry[] =>
  readJson<OfflineOperationLogEntry[]>(OPERATION_LOG_KEY, []).map((entry) => {
    const intent = entry.intent || inferFieldOperationIntent(entry);
    const trace = entry.trace || buildFieldOperationTrace({
      kind: entry.kind,
      target: entry.target,
      metadata: entry.metadata,
    });
    return { ...entry, intent, trace };
  });

const readRuntimeDiagnostics = (): RuntimeDiagnostics =>
  readJson<RuntimeDiagnostics>(RUNTIME_DIAGNOSTICS_KEY, {
    frontendVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) || '0.0.0',
    frontendBuild: (import.meta.env.VITE_APP_BUILD as string | undefined) || 'dev',
    expectedSchemaVersion: (import.meta.env.VITE_EXPECTED_SCHEMA_VERSION as string | undefined) || 'unknown',
    databaseSchemaVersion: null,
    schemaVersionMatches: null,
    lastSchemaCheckAt: null,
    schemaVersionError: null,
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
  intent?: FieldOperationIntent;
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
  const intent = input.intent || inferFieldOperationIntent(input);
  const trace = buildFieldOperationTrace({
    kind: input.kind,
    target: input.target,
    metadata: input.metadata,
  });
  const next: OfflineOperationLogEntry = {
    id,
    intent,
    queue: input.queue,
    status: input.status,
    kind: input.kind,
    target: input.target,
    message: input.message,
    error: toErrorMessage(input.error) || undefined,
    createdAt: previous?.createdAt || timestamp,
    updatedAt: timestamp,
    attempts: previous ? previous.attempts + (input.status === 'replaying' ? 1 : 0) : (input.status === 'replaying' ? 1 : 0),
    trace,
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

export async function getOfflineDiagnosticsSnapshot(): Promise<OfflineDiagnosticsSnapshot> {
  const legacyQueue = await legacyGetAll();
  const walMutations = await walGetAll();
  const scoreWalCount = walMutations.length;
  const operations = readOperationLog();
  const lastReplay = operations.find((entry) => entry.queue === 'coordinator');

  return {
    isBrowserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    legacyQueueCount: legacyQueue.length,
    scoreWalCount,
    totalPending: legacyQueue.length + scoreWalCount,
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
  const expectedSchemaVersion =
    (import.meta.env.VITE_EXPECTED_SCHEMA_VERSION as string | undefined)
    || runtime.expectedSchemaVersion
    || 'unknown';
  const isLocalHost = isLocalNetworkHost();

  if (!isLocalHost) {
    writeRuntimeDiagnostics({
      ...runtime,
      expectedSchemaVersion,
      hpReachable: null,
      localSupabaseReachable: null,
      schemaVersionMatches: null,
      lastHpCheckAt: nowIso(),
      lastHpError: null,
    });
    return;
  }

  const supabaseAnonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY_LAN as string | undefined)
    || (import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL as string | undefined)
    || '';
  const supabaseHeaders = supabaseAnonKey
    ? {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
    }
    : undefined;
  const supabaseUrl = `http://${hostname}:8000/rest/v1/events?select=id&limit=1`;
  const schemaVersionUrl = `http://${hostname}:8000/rest/v1/app_runtime_schema_version?select=schema_version,updated_at&limit=1`;
  let hpReachable = false;
  let localSupabaseReachable = false;
  let lastHpError: string | null = null;
  let databaseSchemaVersion: string | null = runtime.databaseSchemaVersion ?? null;
  let schemaVersionMatches: boolean | null = runtime.schemaVersionMatches ?? null;
  let schemaVersionError: string | null = null;

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
      headers: supabaseHeaders,
    });
    localSupabaseReachable = response.ok;
    if (!response.ok) {
      lastHpError = `Supabase local HTTP ${response.status}`;
    }
  } catch (error) {
    lastHpError = toErrorMessage(error);
  }

  if (localSupabaseReachable) {
    try {
      const response = await fetch(schemaVersionUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: supabaseHeaders,
      });
      if (!response.ok) {
        throw new Error(`Schema version HTTP ${response.status}`);
      }
      const rows = await response.json() as Array<{ schema_version?: string | null }>;
      databaseSchemaVersion = rows[0]?.schema_version || null;
      schemaVersionMatches = Boolean(databaseSchemaVersion)
        && databaseSchemaVersion === expectedSchemaVersion;
      if (!databaseSchemaVersion) {
        schemaVersionError = 'Version schéma absente';
      } else if (!schemaVersionMatches) {
        schemaVersionError = `Schéma HP ${databaseSchemaVersion} attendu ${expectedSchemaVersion}`;
      }
    } catch (error) {
      schemaVersionMatches = false;
      schemaVersionError = toErrorMessage(error);
    }
  } else {
    schemaVersionMatches = null;
  }

  writeRuntimeDiagnostics({
    ...runtime,
    expectedSchemaVersion,
    databaseSchemaVersion,
    schemaVersionMatches,
    lastSchemaCheckAt: nowIso(),
    schemaVersionError,
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
