import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  fromSelects: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  inserts: [] as Array<{ table: string; payload: unknown }>,
  updates: [] as Array<{ table: string; payload: unknown; filters: Array<[string, unknown]> }>,
}));

const makeQuery = (table: string) => {
  const filters: Array<[string, unknown]> = [];
  const query: any = {
    select: vi.fn(() => {
      state.fromSelects.push({ table, filters });
      return query;
    }),
    order: vi.fn(() => query),
    eq: vi.fn((field: string, value: unknown) => {
      filters.push([field, value]);
      return query;
    }),
    in: vi.fn((field: string, values: unknown[]) => {
      filters.push([field, values]);
      return query;
    }),
    limit: vi.fn(async () => ({ data: [], error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn((payload: unknown) => {
      state.updates.push({ table, payload, filters });
      return query;
    }),
    insert: vi.fn(async (payload: unknown) => {
      state.inserts.push({ table, payload });
      return { error: null };
    }),
    upsert: vi.fn(async (payload: unknown) => {
      state.inserts.push({ table, payload });
      return { error: null };
    }),
  };
  return query;
};

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: state.rpc,
    from: vi.fn((table: string) => makeQuery(table)),
  },
  isSupabaseConfigured: () => true,
}));

import {
  fetchHeatEntriesWithParticipants,
  fetchHeatMetadata,
  validateHeatStartDependencies,
  upsertHeatRealtimeConfig,
  upsertActiveHeatPointer,
} from '../heats.api';

describe('Opaque Heat ID preservation in operational API endpoints', () => {
  const opaqueHeatId = 'p38-test2-disposable_open_r1_h1';

  beforeEach(() => {
    vi.clearAllMocks();
    state.fromSelects.length = 0;
    state.inserts.length = 0;
    state.updates.length = 0;
    state.rpc.mockReset();
  });

  it('fetchHeatEntriesWithParticipants queries exact opaque heat_id without transforming hyphens', async () => {
    await fetchHeatEntriesWithParticipants(opaqueHeatId);
    const select = state.fromSelects.find((s) => s.table === 'heat_entries');
    expect(select).toBeDefined();
    expect(select?.filters).toContainEqual(['heat_id', opaqueHeatId]);
    // Must NOT query underscores
    expect(select?.filters).not.toContainEqual(['heat_id', 'p38_test2_disposable_open_r1_h1']);
  });

  it('fetchHeatMetadata queries exact opaque id without transforming hyphens', async () => {
    await fetchHeatMetadata(opaqueHeatId);
    const select = state.fromSelects.find((s) => s.table === 'heats');
    expect(select).toBeDefined();
    expect(select?.filters).toContainEqual(['id', opaqueHeatId]);
    expect(select?.filters).not.toContainEqual(['id', 'p38_test2_disposable_open_r1_h1']);
  });

  it('validateHeatStartDependencies passes exact opaque heat_id to RPC', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, heat_id: opaqueHeatId, blockers: [] },
      error: null,
    });
    const result = await validateHeatStartDependencies(opaqueHeatId);
    expect(state.rpc).toHaveBeenCalledWith('validate_heat_start_dependencies', {
      p_heat_id: opaqueHeatId,
    });
    expect(state.rpc).not.toHaveBeenCalledWith('validate_heat_start_dependencies', {
      p_heat_id: 'p38_test2_disposable_open_r1_h1',
    });
    expect(result.ok).toBe(true);
  });

  it('upsertHeatRealtimeConfig passes exact opaque heat_id to RPC', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: null });
    await upsertHeatRealtimeConfig(opaqueHeatId, {
      status: 'running',
    });
    expect(state.rpc).toHaveBeenCalledWith(
      'upsert_heat_realtime_config',
      expect.objectContaining({
        p_heat_id: opaqueHeatId,
      })
    );
    expect(state.rpc).not.toHaveBeenCalledWith(
      'upsert_heat_realtime_config',
      expect.objectContaining({
        p_heat_id: 'p38_test2_disposable_open_r1_h1',
      })
    );
  });

  it('upsertActiveHeatPointer persists exact opaque active_heat_id', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: null });
    await upsertActiveHeatPointer({
      eventId: 10006,
      eventName: 'P38-Test2-Disposable',
      activeHeatId: opaqueHeatId,
      podiumId: 'A',
    });
    expect(state.rpc).toHaveBeenCalledWith(
      'upsert_active_heat_pointer',
      expect.objectContaining({
        p_event_id: 10006,
        p_event_name: 'P38-Test2-Disposable',
        p_podium_id: 'A',
        p_active_heat_id: opaqueHeatId,
      })
    );
    expect(state.rpc).not.toHaveBeenCalledWith(
      'upsert_active_heat_pointer',
      expect.objectContaining({
        p_active_heat_id: 'p38_test2_disposable_open_r1_h1',
      })
    );
  });
});
