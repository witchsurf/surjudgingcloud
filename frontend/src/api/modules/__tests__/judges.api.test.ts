import { describe, expect, it } from 'vitest';
import { parseLegacyEventJudges, updateLegacyEventJudgeDisplayName } from '../judges.api';

describe('legacy events.judges parser', () => {
  it('accepts arrays of strings without changing serialization', () => {
    const input = ['judge-1', 'judge-2'];
    expect(JSON.stringify(parseLegacyEventJudges(input))).toBe(JSON.stringify(input));
  });

  it('accepts objects with optional name and identity_id unchanged', () => {
    const input = [
      { id: 'judge-1', name: 'One', identity_id: 'identity-1' },
      { id: 'judge-2', name: 'Two' },
      { id: 'judge-3', identity_id: 'identity-3' },
      { id: 'judge-4' },
    ];
    expect(JSON.stringify(parseLegacyEventJudges(input))).toBe(JSON.stringify(input));
  });

  it('accepts mixed string/object arrays unchanged', () => {
    const input = ['judge-1', { id: 'judge-2', name: 'Two' }, { id: 'judge-3' }];
    expect(JSON.stringify(parseLegacyEventJudges(input))).toBe(JSON.stringify(input));
  });

  it('keeps the established final serialization for strings, objects and missing judges', () => {
    expect(updateLegacyEventJudgeDisplayName(['judge-1'], 'judge-1', 'One'))
      .toEqual([{ id: 'judge-1', name: 'One' }]);
    expect(updateLegacyEventJudgeDisplayName(
      [{ id: 'judge-1', identity_id: 'identity-1' }, 'judge-2'], 'judge-1', 'One',
    )).toEqual([{ id: 'judge-1', identity_id: 'identity-1', name: 'One' }, 'judge-2']);
    expect(updateLegacyEventJudgeDisplayName(['judge-1'], 'judge-2', 'Two'))
      .toEqual(['judge-1', { id: 'judge-2', name: 'Two' }]);
  });
});
