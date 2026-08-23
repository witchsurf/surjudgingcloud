import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc },
  isSupabaseConfigured: () => true,
}));

import { propagateQualifiersForSourceHeat, rebuildDivisionQualifiersFromScores } from '../heats.api';

describe('qualification recovery RPC adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the exact propagation RPC/payload and numeric return', async () => {
    rpc.mockResolvedValue({ data: '4', error: null });
    await expect(propagateQualifiersForSourceHeat('event-open-r1-h1')).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledWith('fn_propagate_qualifiers_for_source_heat', {
      p_source_heat_id: 'event-open-r1-h1',
    });
  });

  it('uses the exact rebuild RPC/payload and leaves division unchanged', async () => {
    rpc.mockResolvedValue({ data: 6, error: null });
    await expect(rebuildDivisionQualifiersFromScores(12, 'ONDINE OPEN')).resolves.toBe(6);
    expect(rpc).toHaveBeenCalledWith('rebuild_division_qualifiers_from_scores', {
      p_event_id: 12,
      p_division: 'ONDINE OPEN',
    });
  });

  it.each([
    ['fn_propagate_qualifiers_for_source_heat', () => propagateQualifiersForSourceHeat('h1')],
    ['rebuild_division_qualifiers_from_scores', () => rebuildDivisionQualifiersFromScores(12, 'OPEN')],
  ] as const)('keeps the characterized RPC_UNAVAILABLE error for %s', async (rpcName, invoke) => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: `${rpcName} not found in schema cache` } });
    await expect(invoke()).rejects.toThrow(`RPC_UNAVAILABLE:${rpcName}`);
  });

  it.each([
    ['bad heat', () => propagateQualifiersForSourceHeat('missing')],
    ['bad event/division', () => rebuildDivisionQualifiersFromScores(-1, '')],
  ] as const)('propagates the original RPC error for %s', async (_label, invoke) => {
    const error = Object.assign(new Error('invalid input'), { code: '23503' });
    rpc.mockResolvedValue({ data: null, error });
    await expect(invoke()).rejects.toBe(error);
  });
});
