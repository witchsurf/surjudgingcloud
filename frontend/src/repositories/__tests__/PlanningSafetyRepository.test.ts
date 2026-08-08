import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanningSafetyRepository } from '../PlanningSafetyRepository';
import { fetchPlanningSafetyInventory, persistSafePlanningRpc } from '../../api/modules/planningSafety.api';

vi.mock('../../api/modules/planningSafety.api', () => ({
  fetchPlanningSafetyInventory: vi.fn(),
  persistSafePlanningRpc: vi.fn(),
}));

const fetchMock = vi.mocked(fetchPlanningSafetyInventory);
const persistMock = vi.mocked(persistSafePlanningRpc);

describe('PlanningSafetyRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns SAFE for an empty event/category or only unblocked waiting/open heats', async () => {
    const repository = new PlanningSafetyRepository();
    fetchMock.mockResolvedValueOnce([]);
    await expect(repository.preflight({ eventId: 1, category: 'OPEN', proposedHeatIds: [], overwrite: true }))
      .resolves.toEqual({ state: 'SAFE', targetedHeats: [] });

    fetchMock.mockResolvedValueOnce([
      { heat_id: 'waiting', status: 'waiting', is_active: false, score_count: 0, override_count: 0, interference_count: 0, judge_assignment_count: 0, timer_count: 0, history_count: 0, active_pointer_count: 0, blocker_reasons: [] },
      { heat_id: 'open', status: 'open', is_active: false, score_count: 0, override_count: 0, interference_count: 0, judge_assignment_count: 0, timer_count: 0, history_count: 0, active_pointer_count: 0, blocker_reasons: [] },
    ]);
    const result = await repository.preflight({ eventId: 1, category: 'OPEN', proposedHeatIds: [], overwrite: true });
    expect(result.state).toBe('SAFE');
  });

  it.each([
    ['running status', { status: 'running', blocker_reasons: ['status:running'] }],
    ['closed status', { status: 'closed', blocker_reasons: ['status:closed'] }],
    ['score', { score_count: 1, blocker_reasons: ['scores'] }],
    ['override', { override_count: 1, blocker_reasons: ['score_overrides'] }],
    ['interference', { interference_count: 1, blocker_reasons: ['interferences'] }],
    ['judge assignment', { judge_assignment_count: 1, blocker_reasons: ['judge_assignments'] }],
    ['timer', { timer_count: 1, blocker_reasons: ['timers'] }],
    ['history', { history_count: 1, blocker_reasons: ['history'] }],
    ['active pointer', { active_pointer_count: 1, blocker_reasons: ['active_pointer'] }],
    ['active flag', { is_active: true, blocker_reasons: ['is_active'] }],
  ])('returns BLOCKED for %s', async (_label, patch) => {
    fetchMock.mockResolvedValueOnce([{
      heat_id: 'heat-1', status: 'waiting', is_active: false,
      score_count: 0, override_count: 0, interference_count: 0, judge_assignment_count: 0,
      timer_count: 0, history_count: 0, active_pointer_count: 0, blocker_reasons: [], ...patch,
    }]);
    const result = await new PlanningSafetyRepository().preflight({ eventId: 1, category: 'OPEN', proposedHeatIds: ['heat-1'], overwrite: false });
    expect(result.state).toBe('BLOCKED');
  });

  it('delegates safe persistence without changing payloads', async () => {
    const request = {
      eventId: 1, category: 'OPEN', proposedHeatIds: ['heat-1'], overwrite: false,
      heats: [{ id: 'heat-1' }], entries: [], mappings: [], participants: [], heatConfigs: [],
    };
    await new PlanningSafetyRepository().persistSafePlanning(request);
    expect(persistMock).toHaveBeenCalledWith(request);
  });
});
