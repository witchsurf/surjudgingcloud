import { describe, expect, it } from 'vitest';
import {
  InvalidPersistedScoreMutationError,
  isPersistedScorePayload,
  isValidUuid,
  resolvePersistedScoreMutation,
  type PersistedScoreMutation,
} from '../internal/persistedScorePayload';

const payload = {
  id: '11111111-1111-4111-8111-111111111111',
  event_id: 42,
  heat_id: 'event_open_r1_h1',
  competition: 'Event',
  division: 'OPEN',
  round: 1,
  judge_id: 'judge-1',
  judge_name: 'Judge One',
  judge_station: 'J1',
  judge_identity_id: 'identity-1',
  surfer: 'ROUGE',
  wave_number: 1,
  score: 7.5,
  timestamp: '2026-08-05T10:00:00.000Z',
  created_at: '2026-08-05T10:00:00.001Z',
  synced: false,
};

const mutation = (overrides: Partial<PersistedScoreMutation> = {}): PersistedScoreMutation => ({
  id: '22222222-2222-4222-8222-222222222222',
  timestamp: '2026-08-05T10:00:01.000Z',
  table: 'scores',
  action: 'insert',
  payload,
  ...overrides,
});

describe('P2.5.2b persisted score identity resolution', () => {
  it('accepts the strict current snake_case payload', () => {
    expect(isPersistedScorePayload(payload)).toBe(true);
    expect(isPersistedScorePayload({ ...payload, wave_number: '1' })).toBe(false);
    expect(isPersistedScorePayload({ ...payload, score: Number.NaN })).toBe(false);
  });

  it('F: prefers a valid payload UUID and preserves both payload timestamps', async () => {
    const score = await resolvePersistedScoreMutation(mutation());
    expect(score).toMatchObject({ id: payload.id, timestamp: payload.timestamp, created_at: payload.created_at });
  });

  it('G: falls back to a valid WAL mutation UUID when payload.id is absent', async () => {
    const score = await resolvePersistedScoreMutation(mutation({ payload: { ...payload, id: undefined } }));
    expect(score.id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('H: derives the same version-5 UUID for two replays without a valid UUID', async () => {
    const legacy = mutation({ id: 'legacy-random-id', payload: { ...payload, id: 'not-a-uuid' } });
    const first = await resolvePersistedScoreMutation(legacy);
    const second = await resolvePersistedScoreMutation(structuredClone(legacy));
    expect(first.id).toBe(second.id);
    expect(isValidUuid(first.id)).toBe(true);
    expect(first.id?.[14]).toBe('5');
  });

  it('uses the deterministic chronology fallback without calling now', async () => {
    const score = await resolvePersistedScoreMutation(mutation({
      payload: { ...payload, timestamp: undefined, created_at: undefined },
    }));
    expect(score.timestamp).toBe('2026-08-05T10:00:01.000Z');
    expect(score.created_at).toBe('2026-08-05T10:00:01.000Z');
  });

  it('I: rejects an invalid payload or chronology explicitly', async () => {
    await expect(resolvePersistedScoreMutation(mutation({ payload: { heat_id: 'missing-fields' } })))
      .rejects.toBeInstanceOf(InvalidPersistedScoreMutationError);
    await expect(resolvePersistedScoreMutation(mutation({
      timestamp: 'invalid',
      payload: { ...payload, timestamp: 'invalid', created_at: 'invalid' },
    }))).rejects.toThrow('Chronologie WAL score invalide');
  });
});
