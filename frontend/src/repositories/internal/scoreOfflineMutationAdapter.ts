import type { Score, ScoreOverrideLog } from '../../types';
import { useOfflineStore } from '../../stores/offlineStore';

export interface ScoreOfflineMutationAdapter {
  registerScore(score: Score): void;
  registerOverride(log: ScoreOverrideLog): void;
}

/** Keeps Zustand and the existing WAL payload shape behind an internal boundary. */
export const scoreOfflineMutationAdapter: ScoreOfflineMutationAdapter = Object.freeze({
  registerScore(score) {
    useOfflineStore.getState().registerMutation('scores', 'insert', score);
  },
  registerOverride(log) {
    useOfflineStore.getState().registerMutation('score_overrides', 'insert', log);
  },
});
