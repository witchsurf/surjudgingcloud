import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc },
  isSupabaseConfigured: () => true,
}));

import { activateHeatOnPodium } from '../heats.api';

describe('activateHeatOnPodium legacy RPC payload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the exact characterized RPC name and payload', async () => {
    rpc.mockResolvedValue({
      data: { event_id: 7, podium_id: 'B', heat_id: 'event_open_r1_h1' },
      error: null,
    });
    await activateHeatOnPodium({
      eventId: 7,
      podiumId: ' b ',
      heatId: 'event_open_r1_h1',
      assignedBy: 'admin-auto-podium-activate',
    });
    expect(rpc).toHaveBeenCalledWith('activate_heat_on_podium', {
      p_event_id: 7,
      p_podium_id: 'B',
      p_heat_id: 'event_open_r1_h1',
      p_assigned_by: 'admin-auto-podium-activate',
    });
  });

  it('keeps legacy defaults and propagates RPC errors by identity', async () => {
    const error = Object.assign(new Error('Heat missing does not belong to event 7'), { code: '23503' });
    rpc.mockResolvedValue({ data: null, error });
    await expect(activateHeatOnPodium({ eventId: 7, heatId: 'missing' })).rejects.toBe(error);
    expect(rpc).toHaveBeenCalledWith('activate_heat_on_podium', {
      p_event_id: 7,
      p_podium_id: 'A',
      p_heat_id: 'missing',
      p_assigned_by: 'admin',
    });
  });
});
