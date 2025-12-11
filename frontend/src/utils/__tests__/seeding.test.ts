import { describe, expect, it } from 'vitest';
import { distributeSeedsSnake, determineHeatSize, determineHeatCount } from '../seeding';

describe('distributeSeedsSnake', () => {
  it('distributes 12 participants into 3 heats snake style', () => {
    const heatSize = 4;
    const heatCount = 3;
    const result = distributeSeedsSnake([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], {
      heatSize,
      heatCount,
    });

    expect(result).toHaveLength(3);
    expect(result[0].seeds).toEqual([1, 6, 7, 12]);
    expect(result[1].seeds).toEqual([2, 5, 8, 11]);
    expect(result[2].seeds).toEqual([3, 4, 9, 10]);
  });

  it('balances heats when remainder would create underfilled heats', () => {
    const result = distributeSeedsSnake([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
      heatSize: 4,
      heatCount: 3,
      heatSizes: [4, 3, 3],
    });

    expect(result[0].seeds.length).toBe(4);
    expect(result[1].seeds.length).toBe(3);
    expect(result[2].seeds.length).toBe(3);
  });
});

describe('determine heat helpers', () => {
  it('auto heat size for small counts', () => {
    expect(determineHeatSize(3, 'auto')).toBe(3);
    expect(determineHeatSize(12, 'auto')).toBe(4);
  });

  it('computes heat count', () => {
    expect(determineHeatCount(12, 4)).toBe(3);
    expect(determineHeatCount(5, 3)).toBe(2);
  });
});
