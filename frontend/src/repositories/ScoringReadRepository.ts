import {
  fetchAllInterferenceCallsForEvent,
  fetchInterferenceCalls,
  fetchPreferredScoresForEvent,
  fetchScoresForHeats,
} from '../api/modules/scoring.api';
import { computeEffectiveInterferences } from '../utils/interference';
import type { InterferenceCall, Score } from '../types';
import type {
  EffectiveInterferenceRecord,
  InterferenceCallRecord,
  ScoreRecord,
  ScoringReadRepositoryContract,
} from './contracts';

const toScoreRecord = (score: Score): ScoreRecord => ({
  id: score.id,
  eventId: score.event_id,
  heatId: score.heat_id,
  competition: score.competition,
  division: score.division,
  round: score.round,
  judgeId: score.judge_id,
  judgeName: score.judge_name,
  judgeStation: score.judge_station,
  judgeIdentityId: score.judge_identity_id,
  lycraColor: score.surfer,
  waveNumber: score.wave_number,
  score: score.score,
  timestamp: score.timestamp,
  createdAt: score.created_at,
  synced: score.synced,
});

const toInterferenceRecord = (call: InterferenceCall): InterferenceCallRecord => ({
  id: call.id,
  eventId: call.event_id,
  heatId: call.heat_id,
  judgeId: call.judge_id,
  judgeName: call.judge_name,
  judgeStation: call.judge_station,
  judgeIdentityId: call.judge_identity_id,
  lycraColor: call.surfer,
  waveNumber: call.wave_number,
  type: call.call_type,
  headJudgeOverride: call.is_head_judge_override,
  createdAt: call.created_at,
  updatedAt: call.updated_at,
});

const mapScores = (rows: Readonly<Record<string, readonly Score[]>>) => Object.fromEntries(
  Object.entries(rows).map(([heatId, scores]) => [heatId, scores.map(toScoreRecord)]),
);

const mapInterferences = (rows: Readonly<Record<string, readonly InterferenceCall[]>>) => Object.fromEntries(
  Object.entries(rows).map(([heatId, calls]) => [heatId, calls.map(toInterferenceRecord)]),
);

export class ScoringReadRepository implements ScoringReadRepositoryContract {
  async listForHeats(heatIds: readonly string[]): Promise<Readonly<Record<string, readonly ScoreRecord[]>>> {
    return mapScores(await fetchScoresForHeats([...heatIds]));
  }

  async listPreferredForEvent(eventId: number): Promise<Readonly<Record<string, readonly ScoreRecord[]>>> {
    return mapScores(await fetchPreferredScoresForEvent(eventId));
  }

  async listInterferences(heatId: string): Promise<readonly InterferenceCallRecord[]> {
    return (await fetchInterferenceCalls(heatId)).map(toInterferenceRecord);
  }

  async listInterferencesForEvent(eventId: number): Promise<Readonly<Record<string, readonly InterferenceCallRecord[]>>> {
    return mapInterferences(await fetchAllInterferenceCallsForEvent(eventId));
  }

  async resolveEffectiveInterferences(heatId: string, judgeCount: 3 | 5): Promise<readonly EffectiveInterferenceRecord[]> {
    return computeEffectiveInterferences(await fetchInterferenceCalls(heatId), judgeCount).map((item) => ({
      lycraColor: item.surfer,
      waveNumber: item.waveNumber,
      type: item.type,
      source: item.source,
    }));
  }
}

export const scoringReadRepository = new ScoringReadRepository();
