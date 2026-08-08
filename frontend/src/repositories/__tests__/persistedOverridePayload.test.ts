import { describe, expect, it } from 'vitest';
import {
  InvalidPersistedOverrideMutationError,
  isPersistedOverridePayload,
  resolvePersistedOverrideMutation,
} from '../internal/persistedOverridePayload';

const payload = {
  id: '11111111-1111-4111-8111-111111111111',
  heat_id: 'event-open-r1-h1',
  score_id: '22222222-2222-4222-8222-222222222222',
  judge_id: 'judge-1', judge_name: 'Judge One', judge_station: 'J1', judge_identity_id: 'identity-1',
  surfer: 'ROUGE', wave_number: 2, previous_score: 6, new_score: 7,
  reason: 'correction' as const, comment: 'Correction', overridden_by: 'chief_judge',
  overridden_by_name: 'Chef Judge', created_at: '2026-08-05T10:00:00.000Z',
};
const mutation = (overrides: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333', timestamp: '2026-08-05T10:00:01.000Z',
  table: 'score_overrides' as const, action: 'insert' as const, payload, ...overrides,
});

describe('persisted override WAL identity', () => {
  it('strictly guards the legacy snake_case payload', () => {
    expect(isPersistedOverridePayload(payload)).toBe(true);
    expect(isPersistedOverridePayload({ ...payload, new_score: '7' })).toBe(false);
  });

  it('H preserves payload.id, score_id and created_at', async () => {
    await expect(resolvePersistedOverrideMutation(mutation())).resolves.toMatchObject({
      id: payload.id, score_id: payload.score_id, created_at: payload.created_at,
    });
  });

  it('I uses mutation.id when payload.id is absent', async () => {
    const input = mutation({ payload: { ...payload, id: undefined } });
    await expect(resolvePersistedOverrideMutation(input)).resolves.toMatchObject({ id: input.id });
  });

  it('J derives a stable versioned UUID when both source ids are invalid', async () => {
    const input = mutation({ id: 'legacy-entry', payload: { ...payload, id: 'legacy-log' } });
    const first = await resolvePersistedOverrideMutation(input);
    const second = await resolvePersistedOverrideMutation(input);
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id[14]).toBe('5');
  });

  it('K rejects a missing score_id without inventing a link', async () => {
    await expect(resolvePersistedOverrideMutation(mutation({ payload: { ...payload, score_id: undefined } })))
      .rejects.toThrow('score_id WAL override absent ou invalide');
  });

  it('L rejects invalid chronology instead of using the current time', async () => {
    await expect(resolvePersistedOverrideMutation(mutation({
      timestamp: 'invalid', payload: { ...payload, created_at: 'invalid' },
    }))).rejects.toBeInstanceOf(InvalidPersistedOverrideMutationError);
  });
});
