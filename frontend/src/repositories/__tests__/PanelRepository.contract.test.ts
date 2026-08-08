import { beforeEach, describe, expect, it, vi } from 'vitest';

const panelApi = vi.hoisted(() => ({ fetchPanelContext: vi.fn(), fetchPanelContexts: vi.fn() }));
const heatsApi = vi.hoisted(() => ({
  fetchHeatJudgeAssignments: vi.fn(), fetchEventJudgeAssignments: vi.fn(),
  fetchPodiumJudgePanel: vi.fn(), setPodiumJudgePanel: vi.fn(),
}));
vi.mock('../../api/modules/panelContext.api', () => panelApi);
vi.mock('../../api/modules/heats.api', () => heatsApi);

import { PanelRepository } from '../PanelRepository';

describe('PanelRepository contract', () => {
  const repository = new PanelRepository();
  beforeEach(() => vi.clearAllMocks());

  it('delegates single and batch resolution without inspecting scores', async () => {
    const context = { judgeCount: 3 as const, source: 'heat_config' as const };
    panelApi.fetchPanelContext.mockResolvedValue(context);
    panelApi.fetchPanelContexts.mockResolvedValue(new Map([['h1', context], ['h2', context]]));
    await expect(repository.resolveContext('h1', ['J1', 'J2'])).resolves.toEqual(context);
    await expect(repository.resolveContexts(['h1', 'h2'], { h1: ['J1', 'J2'] })).resolves.toHaveLength(2);
    expect(panelApi.fetchPanelContext).toHaveBeenCalledWith('h1', ['J1', 'J2']);
    expect(panelApi.fetchPanelContexts).toHaveBeenCalledTimes(1);
    expect(panelApi.fetchPanelContexts).toHaveBeenCalledWith(['h1', 'h2'], { h1: ['J1', 'J2'] });
  });

  it('preserves panel issues and operator messages verbatim', async () => {
    const issue = { judgeCount: null, source: 'unknown', issue: 'panel_conflict', message: 'Conflit de panel explicite.' };
    panelApi.fetchPanelContext.mockResolvedValue(issue);
    await expect(repository.resolveContext('h1')).resolves.toBe(issue);
  });

  it('maps heat and event assignments to canonical DTOs', async () => {
    const row = { heat_id: 'h1', event_id: 7, station: 'J1', judge_id: 'judge-1', judge_name: 'Awa', assigned_at: 'a', updated_at: 'u' };
    heatsApi.fetchHeatJudgeAssignments.mockResolvedValue([row]);
    heatsApi.fetchEventJudgeAssignments.mockResolvedValue([row]);
    const expected = { heatId: 'h1', eventId: 7, station: 'J1', judgeId: 'judge-1', judgeName: 'Awa', assignedAt: 'a', updatedAt: 'u' };
    await expect(repository.listHeatAssignments('h1')).resolves.toEqual([expected]);
    await expect(repository.listEventAssignments(7)).resolves.toEqual([expected]);
  });

  it('maps podium reads and keeps an empty panel explicit', async () => {
    heatsApi.fetchPodiumJudgePanel.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      event_id: 7, podium_id: 'B', station: 'J1', judge_id: 'judge-1', judge_name: 'Awa', updated_at: 'u',
    }]);
    await expect(repository.getPodiumPanel(7, 'B')).resolves.toBeNull();
    await expect(repository.getPodiumPanel(7, 'b')).resolves.toEqual({
      eventId: 7, podiumId: 'B', assignments: [{
        heatId: null, eventId: 7, station: 'J1', judgeId: 'judge-1', judgeName: 'Awa', updatedAt: 'u',
      }],
    });
  });

  it('delegates podium mutations without changing assignment metadata', async () => {
    const request = {
      eventId: 7, podiumId: 'B', assignedBy: 'admin-auto',
      assignments: [{ station: 'J1', judgeId: 'judge-1', judgeName: 'Awa' }],
    };
    await repository.setPodiumPanel(request);
    expect(heatsApi.setPodiumJudgePanel).toHaveBeenCalledWith(request);
  });
});
