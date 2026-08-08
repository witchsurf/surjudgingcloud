import { scoreRepository } from '../ScoreRepository';
import { resolvePersistedScoreMutation, type PersistedScoreMutation } from './persistedScorePayload';
import { resolvePersistedOverrideMutation, type PersistedOverrideMutation } from './persistedOverridePayload';

/** Internal WAL replay boundary. It deliberately preserves the legacy payload contract. */
export interface ScoreSyncAdapter {
  replayScore(mutation: PersistedScoreMutation): Promise<void>;
  replayOverride(mutation: PersistedOverrideMutation): Promise<void>;
}

export const scoreSyncAdapter: ScoreSyncAdapter = Object.freeze({
  async replayScore(mutation) {
    await scoreRepository.replayPersistedScore(await resolvePersistedScoreMutation(mutation));
  },
  async replayOverride(request) {
    await scoreRepository.replayPersistedOverride(await resolvePersistedOverrideMutation(request));
  },
});
