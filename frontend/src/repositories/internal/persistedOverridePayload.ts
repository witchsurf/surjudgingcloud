import type { OverrideReason, ScoreOverrideLog } from '../../types';
import { isValidUuid } from './persistedScorePayload';

export interface PersistedOverridePayload {
  id?: string;
  heat_id: string;
  score_id?: string;
  judge_id: string;
  judge_name?: string;
  judge_station?: string;
  judge_identity_id?: string;
  surfer: string;
  wave_number: number;
  previous_score: number | null;
  new_score: number;
  reason: OverrideReason;
  comment?: string;
  overridden_by?: string;
  overridden_by_name?: string;
  created_at?: string;
}

export interface PersistedOverrideMutation {
  id: string;
  timestamp: string;
  table: 'score_overrides';
  action: 'insert' | 'update';
  payload: unknown;
}

export class InvalidPersistedOverrideMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPersistedOverrideMutationError';
  }
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';
const optionalScoreId = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';
const validReason = (value: unknown): value is OverrideReason =>
  value === 'correction' || value === 'omission' || value === 'probleme';
const validTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));

export function isPersistedOverridePayload(value: unknown): value is PersistedOverridePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return optionalString(row.id)
    && nonEmptyString(row.heat_id)
    && optionalScoreId(row.score_id)
    && nonEmptyString(row.judge_id)
    && optionalString(row.judge_name)
    && optionalString(row.judge_station)
    && optionalString(row.judge_identity_id)
    && nonEmptyString(row.surfer)
    && typeof row.wave_number === 'number' && Number.isInteger(row.wave_number) && row.wave_number > 0
    && (row.previous_score === null || (typeof row.previous_score === 'number' && Number.isFinite(row.previous_score)))
    && typeof row.new_score === 'number' && Number.isFinite(row.new_score)
    && validReason(row.reason)
    && optionalString(row.comment)
    && optionalString(row.overridden_by)
    && optionalString(row.overridden_by_name)
    && optionalString(row.created_at);
}

const bytesToUuidV5 = (bytes: Uint8Array): string => {
  const value = new Uint8Array(bytes.slice(0, 16));
  value[6] = (value[6] & 0x0f) | 0x50;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export async function deriveDeterministicOverrideUuid(
  mutation: Pick<PersistedOverrideMutation, 'id' | 'timestamp'>,
  payload: PersistedOverridePayload & { score_id: string },
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new InvalidPersistedOverrideMutationError('Impossible de dériver un UUID override stable : Web Crypto indisponible.');
  }
  const material = [
    'surfjudging-override-wal:v1',
    mutation.id,
    mutation.timestamp,
    payload.score_id,
    payload.heat_id,
    payload.surfer,
    String(payload.wave_number),
  ].join('|');
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(material));
  return bytesToUuidV5(new Uint8Array(digest));
}

export async function resolvePersistedOverrideMutation(
  mutation: PersistedOverrideMutation,
): Promise<ScoreOverrideLog> {
  if (!isPersistedOverridePayload(mutation.payload)) {
    throw new InvalidPersistedOverrideMutationError('Payload WAL override invalide : mutation conservée pour intervention opérateur.');
  }
  const payload = mutation.payload;
  if (!isValidUuid(payload.score_id)) {
    throw new InvalidPersistedOverrideMutationError('score_id WAL override absent ou invalide : mutation conservée sans création de score ou de log.');
  }
  const createdAt = validTimestamp(payload.created_at)
    ? payload.created_at
    : validTimestamp(mutation.timestamp)
      ? mutation.timestamp
      : null;
  if (!createdAt) {
    throw new InvalidPersistedOverrideMutationError('Chronologie WAL override invalide : mutation conservée sans date courante.');
  }
  const id = isValidUuid(payload.id)
    ? payload.id
    : isValidUuid(mutation.id)
      ? mutation.id
      : await deriveDeterministicOverrideUuid(mutation, { ...payload, score_id: payload.score_id });

  return {
    id,
    heat_id: payload.heat_id,
    score_id: payload.score_id,
    judge_id: payload.judge_id,
    judge_name: payload.judge_name || payload.judge_id,
    judge_station: payload.judge_station || payload.judge_id,
    judge_identity_id: payload.judge_identity_id,
    surfer: payload.surfer,
    wave_number: payload.wave_number,
    previous_score: payload.previous_score,
    new_score: payload.new_score,
    reason: payload.reason,
    comment: payload.comment,
    overridden_by: payload.overridden_by || 'chief_judge',
    overridden_by_name: payload.overridden_by_name || 'Chef Judge',
    created_at: createdAt,
  };
}
