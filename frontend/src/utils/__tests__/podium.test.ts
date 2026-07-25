import { describe, expect, it } from 'vitest';
import { shouldPreferActivePointer } from '../podium';

describe('shouldPreferActivePointer', () => {
  it('keeps the legacy timestamp rule for podium A', () => {
    expect(shouldPreferActivePointer('A', '2026-07-25T12:00:00Z', '2026-07-25T11:00:00Z')).toBe(false);
    expect(shouldPreferActivePointer('A', '2026-07-25T12:00:00Z', '2026-07-25T13:00:00Z')).toBe(true);
  });

  it('always treats an explicit podium B pointer as authoritative', () => {
    expect(shouldPreferActivePointer('B', '2026-07-25T13:00:00Z', '2026-07-25T11:00:00Z')).toBe(true);
  });
});
