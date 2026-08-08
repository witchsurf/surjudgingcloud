import { describe, expect, it } from 'vitest';
import type { InterferenceCall } from '../../../types';
import { computeEffectiveInterferences } from '../../../utils/interference';
import { computeEffectiveInterferenceDecisions } from '../engine';
import type { InterferenceVote, SupportedPanelSize } from '../contracts';

const vote = (judge: string, type: 'INT1' | 'INT2', overrides: Partial<InterferenceVote> = {}): InterferenceVote => ({
  id: `${judge}-${type}`,
  lycraColor: 'BLANC',
  waveNumber: 1,
  judgeStation: judge,
  type,
  timestamp: '2026-03-23T10:00:00.000Z',
  createdAt: '2026-03-23T10:00:00.000Z',
  headJudgeOverride: false,
  ...overrides,
});

const legacy = (votes: readonly InterferenceVote[], panel: SupportedPanelSize) => computeEffectiveInterferences(votes.map<InterferenceCall>((item) => ({
  id: item.id,
  heat_id: 'heat-interference-parity',
  judge_id: item.judgeStation,
  surfer: item.lycraColor,
  wave_number: item.waveNumber,
  call_type: item.type,
  updated_at: item.timestamp,
  created_at: item.createdAt,
  is_head_judge_override: item.headJudgeOverride,
})), panel);

const engineComparable = (votes: readonly InterferenceVote[], panel: SupportedPanelSize) => computeEffectiveInterferenceDecisions(votes, panel).map((item) => ({
  surfer: item.lycraColor,
  waveNumber: item.waveNumber,
  type: item.type,
  source: item.source === 'panel' ? 'majority' : 'head_judge',
}));

describe('effective interference parity', () => {
  it.each([
    { panel: 3 as const, votes: [vote('J1', 'INT1'), vote('J2', 'INT1')] },
    { panel: 5 as const, votes: [vote('J1', 'INT2'), vote('J2', 'INT2'), vote('J3', 'INT2')] },
    { panel: 3 as const, votes: [vote('J1', 'INT1'), vote('J2', 'INT2')] },
    { panel: 3 as const, votes: [vote('CJ', 'INT2', { headJudgeOverride: true })] },
  ])('matches legacy majority/override for $panel judges', ({ panel, votes }) => {
    expect(engineComparable(votes, panel)).toEqual(legacy(votes, panel));
  });
});
