import type { Score, ScoreOverrideLog } from '../../types';
import type {
  OverrideScoreRequest as CanonicalOverrideScoreRequest,
  OverrideScoreResult as CanonicalOverrideScoreResult,
  SaveScoreRequest as CanonicalSaveScoreRequest,
  ScoreOverrideLogRecord,
  ScoreRecord,
} from '../contracts';

export interface LegacySaveScoreRequest {
  heatId: string;
  competition: string;
  division: string;
  round: number;
  judgeId: string;
  judgeName: string;
  judgeStation?: string;
  judgeIdentityId?: string;
  surfer: string;
  waveNumber: number;
  score: number;
  eventId?: number | null;
}

export interface LegacyOverrideScoreRequest extends Omit<LegacySaveScoreRequest, 'score' | 'eventId'> {
  newScore: number;
  reason: CanonicalOverrideScoreRequest['reason'];
  comment?: string;
}

export interface LegacyOverrideScoreResult {
  updatedScore: Score;
  previousScore: Score | undefined;
  log: ScoreOverrideLog;
}

export const canonicalSaveRequestToLegacy = (request: CanonicalSaveScoreRequest): LegacySaveScoreRequest => ({
  heatId: request.heatId,
  competition: request.competition,
  division: request.division,
  round: request.round,
  judgeId: request.judgeId,
  judgeName: request.judgeName,
  judgeStation: request.judgeStation,
  judgeIdentityId: request.judgeIdentityId,
  surfer: request.lycraColor,
  waveNumber: request.waveNumber,
  score: request.score,
  eventId: request.eventId,
});

export const canonicalOverrideRequestToLegacy = (request: CanonicalOverrideScoreRequest): LegacyOverrideScoreRequest => ({
  heatId: request.heatId,
  competition: request.competition,
  division: request.division,
  round: request.round,
  judgeId: request.judgeId,
  judgeName: request.judgeName,
  judgeStation: request.judgeStation,
  judgeIdentityId: request.judgeIdentityId,
  surfer: request.lycraColor,
  waveNumber: request.waveNumber,
  newScore: request.newScore,
  reason: request.reason,
  comment: request.comment,
});

export const legacyScoreToRecord = (score: Score): ScoreRecord => ({
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

export const scoreRecordToLegacy = (score: ScoreRecord): Score => ({
  id: score.id,
  event_id: score.eventId,
  heat_id: score.heatId,
  competition: score.competition,
  division: score.division,
  round: score.round,
  judge_id: score.judgeId,
  judge_name: score.judgeName,
  judge_station: score.judgeStation,
  judge_identity_id: score.judgeIdentityId,
  surfer: score.lycraColor,
  wave_number: score.waveNumber,
  score: score.score,
  timestamp: score.timestamp,
  created_at: score.createdAt,
  synced: score.synced,
});

export const legacyOverrideLogToRecord = (log: ScoreOverrideLog): ScoreOverrideLogRecord => ({
  id: log.id,
  heatId: log.heat_id,
  scoreId: log.score_id,
  judgeId: log.judge_id,
  judgeName: log.judge_name,
  judgeStation: log.judge_station,
  judgeIdentityId: log.judge_identity_id,
  lycraColor: log.surfer,
  waveNumber: log.wave_number,
  previousScore: log.previous_score,
  newScore: log.new_score,
  reason: log.reason,
  comment: log.comment,
  overriddenBy: log.overridden_by,
  overriddenByName: log.overridden_by_name,
  createdAt: log.created_at,
});

export const scoreOverrideLogRecordToLegacy = (log: ScoreOverrideLogRecord): ScoreOverrideLog => ({
  id: log.id,
  heat_id: log.heatId,
  score_id: log.scoreId,
  judge_id: log.judgeId,
  judge_name: log.judgeName,
  judge_station: log.judgeStation,
  judge_identity_id: log.judgeIdentityId,
  surfer: log.lycraColor,
  wave_number: log.waveNumber,
  previous_score: log.previousScore,
  new_score: log.newScore,
  reason: log.reason,
  comment: log.comment,
  overridden_by: log.overriddenBy,
  overridden_by_name: log.overriddenByName,
  created_at: log.createdAt,
});

export const legacyOverrideResultToRecord = (result: LegacyOverrideScoreResult): CanonicalOverrideScoreResult => ({
  updatedScore: legacyScoreToRecord(result.updatedScore),
  previousScore: result.previousScore ? legacyScoreToRecord(result.previousScore) : undefined,
  log: legacyOverrideLogToRecord(result.log),
});
