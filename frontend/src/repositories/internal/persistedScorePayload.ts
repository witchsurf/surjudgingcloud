import type { Score } from '../../types';

export interface PersistedScorePayload {
  id?: string;
  event_id?: number | null;
  heat_id: string;
  competition: string;
  division: string;
  round: number;
  judge_id: string;
  judge_name: string;
  judge_station?: string;
  judge_identity_id?: string;
  surfer: string;
  wave_number: number;
  score: number;
  timestamp?: string;
  created_at?: string;
  synced?: boolean;
}

export interface PersistedScoreMutation {
  id: string;
  timestamp: string;
  table: 'scores';
  action: 'insert' | 'update';
  payload: unknown;
}

export class InvalidPersistedScoreMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPersistedScoreMutationError';
  }
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';
const optionalEventId = (value: unknown): value is number | null | undefined =>
  value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));

export function isPersistedScorePayload(value: unknown): value is PersistedScorePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return optionalString(row.id)
    && optionalEventId(row.event_id)
    && nonEmptyString(row.heat_id)
    && nonEmptyString(row.competition)
    && nonEmptyString(row.division)
    && typeof row.round === 'number' && Number.isFinite(row.round)
    && nonEmptyString(row.judge_id)
    && nonEmptyString(row.judge_name)
    && optionalString(row.judge_station)
    && optionalString(row.judge_identity_id)
    && nonEmptyString(row.surfer)
    && typeof row.wave_number === 'number' && Number.isInteger(row.wave_number) && row.wave_number > 0
    && typeof row.score === 'number' && Number.isFinite(row.score)
    && optionalString(row.timestamp)
    && optionalString(row.created_at)
    && (row.synced === undefined || typeof row.synced === 'boolean');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

const validTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));

const bytesToUuidV5 = (bytes: Uint8Array): string => {
  const value = new Uint8Array(bytes.slice(0, 16));
  value[6] = (value[6] & 0x0f) | 0x50;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export async function deriveDeterministicScoreUuid(
  mutation: Pick<PersistedScoreMutation, 'id' | 'timestamp'>,
  payload: PersistedScorePayload,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new InvalidPersistedScoreMutationError('Impossible de dériver un UUID stable : Web Crypto indisponible.');
  }
  const material = [
    'surfjudging-score-wal:v1',
    mutation.id,
    mutation.timestamp,
    payload.heat_id,
    payload.surfer,
    String(payload.wave_number),
    payload.judge_station || payload.judge_id,
  ].join('|');
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(material));
  return bytesToUuidV5(new Uint8Array(digest));
}

export async function resolvePersistedScoreMutation(mutation: PersistedScoreMutation): Promise<Score> {
  if (!isPersistedScorePayload(mutation.payload)) {
    throw new InvalidPersistedScoreMutationError('Payload WAL score invalide : mutation conservée pour intervention opérateur.');
  }
  const payload = mutation.payload;
  const id = isValidUuid(payload.id)
    ? payload.id
    : isValidUuid(mutation.id)
      ? mutation.id
      : await deriveDeterministicScoreUuid(mutation, payload);

  const timestamp = validTimestamp(payload.timestamp)
    ? payload.timestamp
    : validTimestamp(payload.created_at)
      ? payload.created_at
      : validTimestamp(mutation.timestamp)
        ? mutation.timestamp
        : null;
  const createdAt = validTimestamp(payload.created_at)
    ? payload.created_at
    : validTimestamp(payload.timestamp)
      ? payload.timestamp
      : validTimestamp(mutation.timestamp)
        ? mutation.timestamp
        : null;

  if (!timestamp || !createdAt) {
    throw new InvalidPersistedScoreMutationError('Chronologie WAL score invalide : mutation conservée pour intervention opérateur.');
  }

  return {
    id,
    event_id: payload.event_id ?? undefined,
    heat_id: payload.heat_id,
    competition: payload.competition,
    division: payload.division,
    round: payload.round,
    judge_id: payload.judge_id,
    judge_name: payload.judge_name,
    judge_station: payload.judge_station || payload.judge_id,
    judge_identity_id: payload.judge_identity_id,
    surfer: payload.surfer,
    wave_number: payload.wave_number,
    score: payload.score,
    timestamp,
    created_at: createdAt,
    synced: false,
  };
}
