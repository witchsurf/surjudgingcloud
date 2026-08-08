import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineMutation } from '../offlineStore';

const mocks = vi.hoisted(() => ({
  replayScore: vi.fn(async () => undefined),
  replayOverride: vi.fn(async () => undefined),
}));

vi.mock('../../repositories/internal/scoreSyncAdapter', () => ({ scoreSyncAdapter: mocks }));

import { replayScoreWalMutation } from '../scoreWalExecutor';

const scorePayload = {
  id: 'persisted-wal-uuid', event_id: 42, heat_id: 'event-open-r1-h1',
  competition: 'Event', division: 'OPEN', round: 1,
  judge_id: 'judge-1', judge_name: 'Judge One', judge_station: 'J1', judge_identity_id: 'identity-1',
  surfer: 'ROUGE', wave_number: 2, score: 7.5,
  timestamp: '2026-08-05T10:00:00.000Z', created_at: '2026-08-05T10:00:00.001Z', synced: false,
};

const mutation = (table: OfflineMutation['table'], payload: Record<string, unknown>): OfflineMutation => ({
  id: 'wal-entry-id', table, action: 'insert', payload,
  timestamp: '2026-08-05T10:00:00.000Z',
});

describe('P2.5 score WAL executor boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replays the existing score payload through the technical adapter without changing source keys', async () => {
    const payloadBefore = structuredClone(scorePayload);
    const walMutation = mutation('scores', scorePayload);
    await replayScoreWalMutation(walMutation);

    expect(scorePayload).toEqual(payloadBefore);
    expect(mocks.replayScore).toHaveBeenCalledWith(walMutation);
  });

  it('replays the existing override payload through the technical adapter unchanged', async () => {
    const payload = {
      ...scorePayload,
      new_score: 8.1,
      reason: 'correction' as const,
      comment: 'P2.5 WAL parity',
    };
    const payloadBefore = structuredClone(payload);
    const walMutation = mutation('score_overrides', payload);
    await replayScoreWalMutation(walMutation);

    expect(payload).toEqual(payloadBefore);
    expect(mocks.replayOverride).toHaveBeenCalledWith(walMutation);
  });
});
