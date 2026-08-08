import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPanelContextCache, getCachedPanelContexts } from '../panelContextCache';

describe('DisplayPage panel context cache', () => {
  beforeEach(() => clearPanelContextCache());

  it('deduplicates concurrent and repeated reads for the same heat and runtime snapshot', async () => {
    const loader = vi.fn(async (heatIds: readonly string[]) => new Map(
      heatIds.map((heatId) => [heatId, { judgeCount: 3 as const, source: 'heat_config' as const }]),
    ));
    const snapshots = { 'heat-a': ['J1', 'J2', 'J3'] };

    const [first, second] = await Promise.all([
      getCachedPanelContexts(['heat-a'], snapshots, loader),
      getCachedPanelContexts(['heat-a'], snapshots, loader),
    ]);
    const third = await getCachedPanelContexts(['heat-a'], snapshots, loader);

    expect(first.get('heat-a')).toMatchObject({ judgeCount: 3 });
    expect(second.get('heat-a')).toMatchObject({ judgeCount: 3 });
    expect(third.get('heat-a')).toMatchObject({ judgeCount: 3 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loads several historical heats in one batch instead of an N+1', async () => {
    const loader = vi.fn(async (heatIds: readonly string[]) => new Map(
      heatIds.map((heatId) => [heatId, { judgeCount: 5 as const, source: 'assignments' as const }]),
    ));
    const contexts = await getCachedPanelContexts(['heat-a', 'heat-b', 'heat-c'], undefined, loader);
    expect(contexts).toHaveLength(3);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(['heat-a', 'heat-b', 'heat-c'], undefined);
  });

  it('does not permanently cache a transient panel network error', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce(new Map([['heat-a', {
        judgeCount: null, source: 'unknown', issue: 'network_error', message: 'Erreur réseau',
      }]]))
      .mockResolvedValueOnce(new Map([['heat-a', { judgeCount: 3, source: 'heat_config' }]]));

    expect((await getCachedPanelContexts(['heat-a'], undefined, loader)).get('heat-a')?.issue).toBe('network_error');
    expect((await getCachedPanelContexts(['heat-a'], undefined, loader)).get('heat-a')?.judgeCount).toBe(3);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
