import { scoreRepository } from '../repositories/ScoreRepository';
import type { OfflineMutation } from './offlineStore';

export async function replayScoreWalMutation(mutation: OfflineMutation): Promise<void> {
  const payload = mutation.payload;

  if (mutation.table === 'scores') {
    await scoreRepository.saveScore({
      heatId: payload.heat_id,
      competition: payload.competition,
      division: payload.division,
      round: payload.round,
      judgeId: payload.judge_id,
      judgeName: payload.judge_name,
      judgeStation: payload.judge_station,
      judgeIdentityId: payload.judge_identity_id,
      surfer: payload.surfer,
      waveNumber: payload.wave_number,
      score: payload.score,
      eventId: payload.event_id,
    });
    return;
  }

  if (mutation.table === 'score_overrides') {
    await scoreRepository.overrideScore({
      heatId: payload.heat_id,
      competition: payload.competition,
      division: payload.division,
      round: payload.round,
      judgeId: payload.judge_id,
      judgeName: payload.judge_name,
      judgeStation: payload.judge_station,
      judgeIdentityId: payload.judge_identity_id,
      surfer: payload.surfer,
      waveNumber: payload.wave_number,
      newScore: payload.new_score,
      reason: payload.reason,
      comment: payload.comment,
    });
  }
}
