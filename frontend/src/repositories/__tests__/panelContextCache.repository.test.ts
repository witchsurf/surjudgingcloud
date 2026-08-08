import { beforeEach, describe, expect, it, vi } from 'vitest';
import { panelRepository } from '../PanelRepository';
import { clearPanelContextCache, getRepositoryPanelContexts } from '../panelContextCache';

describe('repository-backed shared panel cache', () => {
  beforeEach(() => {
    clearPanelContextCache();
    vi.restoreAllMocks();
  });

  it('shares concurrent/repeated reads and keeps one batch for several heats', async () => {
    const resolve = vi.spyOn(panelRepository, 'resolveContexts').mockImplementation(async (heatIds) => new Map(
      heatIds.map((heatId) => [heatId, { judgeCount: 3 as const, source: 'heat_config' as const }]),
    ));
    const [first, second] = await Promise.all([
      getRepositoryPanelContexts(['h1', 'h2']),
      getRepositoryPanelContexts(['h1', 'h2']),
    ]);
    const third = await getRepositoryPanelContexts(['h1', 'h2']);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(third).toHaveLength(2);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(['h1', 'h2'], undefined);
  });

  it('keeps network errors retryable instead of caching them', async () => {
    const resolve = vi.spyOn(panelRepository, 'resolveContexts')
      .mockResolvedValueOnce(new Map([['h1', {
        judgeCount: null, source: 'unknown', issue: 'network_error', message: 'Erreur réseau',
      }]]))
      .mockResolvedValueOnce(new Map([['h1', { judgeCount: 5, source: 'assignments' }]]));
    expect((await getRepositoryPanelContexts(['h1'])).get('h1')?.issue).toBe('network_error');
    expect((await getRepositoryPanelContexts(['h1'])).get('h1')?.judgeCount).toBe(5);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
