import { describe, expect, it } from 'vitest';
import { computeEffectiveInterferences, summarizeInterferenceBySurfer } from '../interference';
import type { InterferenceCall } from '../../types';

describe('interference normalization', () => {
  it('shows a bilingual majority call on the canonical surfer', () => {
    const calls: InterferenceCall[] = [
      { heat_id: 'h1', judge_id: 'J1', surfer: 'BLANC', wave_number: 1, call_type: 'INT1' },
      { heat_id: 'h1', judge_id: 'J2', surfer: 'WHITE', wave_number: 1, call_type: 'INT1' },
    ];

    const effective = computeEffectiveInterferences(calls, 3);
    expect(effective).toEqual([
      { surfer: 'WHITE', waveNumber: 1, type: 'INT1', source: 'majority' },
    ]);
    expect(summarizeInterferenceBySurfer(effective).get('WHITE')).toMatchObject({
      count: 1,
      type: 'INT1',
      isDisqualified: false,
    });
  });
});
