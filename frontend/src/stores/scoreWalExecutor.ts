import { scoreSyncAdapter } from '../repositories/internal/scoreSyncAdapter';
import type { OfflineMutation } from './offlineStore';

export async function replayScoreWalMutation(mutation: OfflineMutation): Promise<void> {
  const payload = mutation.payload;

  if (mutation.table === 'scores') {
    await scoreSyncAdapter.replayScore({
      id: mutation.id,
      timestamp: mutation.timestamp,
      table: 'scores',
      action: mutation.action,
      payload,
    });
    return;
  }

  if (mutation.table === 'score_overrides') {
    await scoreSyncAdapter.replayOverride({
      id: mutation.id,
      timestamp: mutation.timestamp,
      table: 'score_overrides',
      action: mutation.action,
      payload,
    });
  }
}
