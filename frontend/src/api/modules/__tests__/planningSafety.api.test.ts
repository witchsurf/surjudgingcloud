import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../core.api', () => ({ ensureSupabase: vi.fn() }));

import { fetchPlanningSafetyInventory, persistSafePlanningRpc } from '../planningSafety.api';

describe('planning safety API adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends exact overwrite=false collision inputs and parses bigint counts', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      heat_id: 'heat-1', status: 'waiting', is_active: false,
      score_count: '0', override_count: 0, interference_count: 0,
      judge_assignment_count: 0, timer_count: 0, history_count: 0,
      active_pointer_count: 0, blocker_reasons: [],
    }], error: null });
    const result = await fetchPlanningSafetyInventory({
      eventId: 9, category: 'OPEN', proposedHeatIds: ['new-1', 'new-2'], overwrite: false,
    });
    expect(rpc).toHaveBeenCalledWith('check_heat_planning_safety', {
      p_event_id: 9, p_category: 'OPEN', p_proposed_heat_ids: ['new-1', 'new-2'], p_overwrite: false,
    });
    expect(result[0].score_count).toBe(0);
  });

  it('propagates network/RPC errors so callers return UNKNOWN', async () => {
    const failure = { message: 'network down' };
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(fetchPlanningSafetyInventory({ eventId: 9, category: 'OPEN', proposedHeatIds: [], overwrite: true }))
      .rejects.toBe(failure);
  });

  it('calls only the atomic safe RPC for persistence', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await persistSafePlanningRpc({
      eventId: 9, category: 'OPEN', proposedHeatIds: ['heat-1'], overwrite: false,
      heats: [{ id: 'heat-1' }], entries: [], mappings: [], participants: [],
      heatConfigs: [{ heat_id: 'heat-1', judges: ['J1', 'J2', 'J3'] }],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bulk_upsert_heats_safe_v2', {
      p_event_id: 9, p_category: 'OPEN', p_overwrite: false,
      p_heats: [{ id: 'heat-1' }], p_entries: [], p_mappings: [], p_participants: [],
      p_heat_configs: [{ heat_id: 'heat-1', judges: ['J1', 'J2', 'J3'] }],
    });
  });
});
