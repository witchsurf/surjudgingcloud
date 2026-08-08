import { describe, expect, it, vi } from 'vitest';
import type { Score, ScoreOverrideLog } from '../../types';
import type { OverrideScoreRequest, SaveScoreRequest, ScoreRepositoryContract } from '../contracts';
import { ScoreRepository } from '../ScoreRepository';
import {
  canonicalOverrideRequestToLegacy,
  canonicalSaveRequestToLegacy,
  legacyOverrideLogToRecord,
  legacyScoreToRecord,
  scoreOverrideLogRecordToLegacy,
  scoreRecordToLegacy,
} from '../internal/scoreRepositoryMappings';

const canonicalSave: SaveScoreRequest = {
  heatId: 'event-open-r1-h1', competition: 'Event', division: 'OPEN', round: 1,
  eventId: 42, judgeId: 'judge-1', judgeName: 'Judge One', judgeStation: 'J1',
  judgeIdentityId: 'identity-1', lycraColor: 'ROUGE', waveNumber: 2, score: 7.5,
};

const legacyScore: Score = {
  id: 'fixed-mutation-uuid', event_id: 42, heat_id: 'event-open-r1-h1', competition: 'Event',
  division: 'OPEN', round: 1, judge_id: 'judge-1', judge_name: 'Judge One', judge_station: 'J1',
  judge_identity_id: 'identity-1', surfer: 'ROUGE', wave_number: 2, score: 7.5,
  timestamp: '2026-08-05T10:00:00.000Z', created_at: '2026-08-05T10:00:00.001Z', synced: false,
};

const legacyLog: ScoreOverrideLog = {
  id: 'override-uuid', heat_id: legacyScore.heat_id, score_id: legacyScore.id!,
  judge_id: legacyScore.judge_id, judge_name: legacyScore.judge_name,
  judge_station: legacyScore.judge_station, judge_identity_id: legacyScore.judge_identity_id,
  surfer: legacyScore.surfer, wave_number: legacyScore.wave_number,
  previous_score: 7.1, new_score: 7.5, reason: 'correction', comment: 'P2.5 parity',
  overridden_by: 'chief_judge', overridden_by_name: 'Chef Judge', created_at: '2026-08-05T10:01:00.000Z',
};

describe('P2.5 ScoreRepository canonical mappings', () => {
  it('maps lycra, judge identity, station and input fields without changing values', () => {
    expect(canonicalSaveRequestToLegacy(canonicalSave)).toEqual({
      ...canonicalSave,
      surfer: canonicalSave.lycraColor,
      lycraColor: undefined,
    });
  });

  it('round-trips mutation UUID and timestamps exactly', () => {
    expect(scoreRecordToLegacy(legacyScoreToRecord(legacyScore))).toEqual(legacyScore);
    expect(scoreOverrideLogRecordToLegacy(legacyOverrideLogToRecord(legacyLog))).toEqual(legacyLog);
  });

  it('maps canonical override lycra to the existing surfer payload', () => {
    const request: OverrideScoreRequest = {
      ...canonicalSave,
      newScore: 8.1,
      reason: 'omission',
      comment: 'test',
    };
    const { score: _score, eventId: _eventId, lycraColor: _lycraColor, ...expected } = request;
    expect(canonicalOverrideRequestToLegacy(request)).toEqual({ ...expected, surfer: 'ROUGE' });
  });

  it('implements the canonical contract by delegating to the unchanged legacy save path', async () => {
    const repository: ScoreRepositoryContract = new ScoreRepository();
    const legacySave = vi.spyOn(repository as ScoreRepository, 'saveScore').mockResolvedValue({ ...legacyScore });

    const result = await repository.save(canonicalSave);

    expect(legacySave).toHaveBeenCalledWith(canonicalSaveRequestToLegacy(canonicalSave));
    expect(result).toEqual(legacyScoreToRecord(legacyScore));
  });
});
