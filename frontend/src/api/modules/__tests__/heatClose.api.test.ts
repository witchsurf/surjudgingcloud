import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc },
  isSupabaseConfigured: () => true,
}));

import { closeHeatOnPodium } from '../heats.api';

const request = {
  eventId: 7,
  podiumId: ' b ',
  heatId: 'event_open_r1_h1',
  nextHeatId: 'event_open_r1_h2',
  closedBy: 'admin-close-heat',
  force: false,
  forceReason: null,
};

const strictPayload = {
  p_event_id: 7,
  p_podium_id: 'B',
  p_heat_id: 'event_open_r1_h1',
  p_next_heat_id: 'event_open_r1_h2',
  p_closed_by: 'admin-close-heat',
  p_force: false,
  p_force_reason: null,
};

const legacyPayload = {
  p_event_id: 7,
  p_podium_id: 'B',
  p_heat_id: 'event_open_r1_h1',
  p_next_heat_id: 'event_open_r1_h2',
  p_closed_by: 'admin-close-heat',
};

describe('closeHeatOnPodium strict/legacy adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses strict first with the exact payload and returns qualification unchanged', async () => {
    const result = { qualifier_slots_updated: 2, division_slots_rebuilt: 3 };
    rpc.mockResolvedValue({ data: result, error: null });
    await expect(closeHeatOnPodium(request)).resolves.toBe(result);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('close_heat_on_podium_strict', strictPayload);
  });

  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function public.close_heat_on_podium_strict in the schema cache' }],
    [{ code: '42883', message: 'function public.close_heat_on_podium_strict does not exist' }],
    [{ message: 'Could not find function close_heat_on_podium_strict in schema cache' }],
  ])('falls back only when the strict RPC is unavailable', async (strictError) => {
    rpc
      .mockResolvedValueOnce({ data: null, error: strictError })
      .mockResolvedValueOnce({ data: { qualifier_slots_updated: 1 }, error: null });
    await closeHeatOnPodium(request);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(['close_heat_on_podium_strict', strictPayload]);
    expect(rpc.mock.calls[1]).toEqual(['close_heat_on_podium', legacyPayload]);
  });

  it.each([
    [{ code: '23514', message: 'HEAT_CLOSE_BLOCKED:{"can_close":false}' }],
    [{ code: '42501', message: 'permission denied for function close_heat_on_podium_strict' }],
    [{ code: '23503', message: 'Heat h1 does not belong to event 7' }],
    [{ code: '23514', message: 'Heat h1 is not active on podium B' }],
  ])('never sends business/RLS/constraint errors to the legacy RPC', async (strictError) => {
    rpc.mockResolvedValue({ data: null, error: strictError });
    await expect(closeHeatOnPodium(request)).rejects.toBe(strictError);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('close_heat_on_podium_strict', strictPayload);
  });

  it('never falls back for forced closure when strict is unavailable', async () => {
    const strictError = { code: 'PGRST202', message: 'close_heat_on_podium_strict missing from schema cache' };
    rpc.mockResolvedValue({ data: null, error: strictError });
    await expect(closeHeatOnPodium({ ...request, force: true, forceReason: 'Décision chef juge' })).rejects.toBe(strictError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps default/null payload values unchanged', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await closeHeatOnPodium({ eventId: 7, heatId: 'h1' });
    expect(rpc).toHaveBeenCalledWith('close_heat_on_podium_strict', {
      p_event_id: 7, p_podium_id: 'A', p_heat_id: 'h1', p_next_heat_id: null,
      p_closed_by: 'admin', p_force: false, p_force_reason: null,
    });
  });
});
