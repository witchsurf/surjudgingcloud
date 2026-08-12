import { describe, expect, it } from 'vitest';
import type { Score } from '../../types';
import { normalizePersistedScores } from '../useSupabaseSync';

const baseScore: Score = {
  id: '00000000-0000-4000-8000-000000000001',
  event_id: 10,
  heat_id: 'mamelles_open_junior_r1_h1',
  competition: 'MAMELLES OPEN',
  division: 'JUNIOR',
  round: 1,
  judge_id: 'J1',
  judge_name: 'CHARLES',
  judge_station: 'J1',
  judge_identity_id: '5164895e-51e9-42f2-9583-80a3e36cc435',
  surfer: 'RED',
  wave_number: 1,
  score: 7,
  timestamp: '2026-08-11T22:18:39.110Z',
  created_at: '2026-08-11T22:18:39.110Z',
  synced: true,
};

describe('useSupabaseSync score hydration', () => {
  it('preserves valid UUID ids during display hydration', () => {
    const result = normalizePersistedScores([baseScore], () => 'replacement-id');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(baseScore.id);
    expect(result[0].heat_id).toBe('mamelles_open_junior_r1_h1');
  });

  it('repairs invalid ids with the provided generator', () => {
    const result = normalizePersistedScores([{ ...baseScore, id: 'legacy-id' }], () => '00000000-0000-4000-8000-000000000099');

    expect(result[0].id).toBe('00000000-0000-4000-8000-000000000099');
  });
});
