import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  limitResponses: [] as Array<{ data: unknown; error: unknown }>,
  queryFilters: [] as Array<Array<[string, unknown]>>,
  inserts: [] as unknown[],
  updates: [] as unknown[],
}));

const makeQuery = () => {
  const filters: Array<[string, unknown]> = [];
  state.queryFilters.push(filters);
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    eq: vi.fn((field: string, value: unknown) => { filters.push([field, value]); return query; }),
    limit: vi.fn(async () => state.limitResponses.shift() ?? { data: [], error: null }),
    update: vi.fn((payload: unknown) => { state.updates.push(payload); return query; }),
    insert: vi.fn(async (payload: unknown) => { state.inserts.push(payload); return { error: null }; }),
  };
  return query;
};

vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc: state.rpc, from: vi.fn(() => makeQuery()) },
  isSupabaseConfigured: () => true,
}));

import { fetchActiveHeatPointer, upsertActiveHeatPointer } from '../heats.api';

const pointer = (podiumId: string, heatId: string) => ({
  event_id: 7, event_name: 'Open', podium_id: podiumId,
  active_heat_id: heatId, updated_at: '2026-08-06T00:00:00.000Z',
});

describe('active heat pointer legacy adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.limitResponses.length = 0;
    state.queryFilters.length = 0;
    state.inserts.length = 0;
    state.updates.length = 0;
    window.localStorage.clear();
  });

  it.each([['A', 'open_r1_h1'], ['B', 'open_r1_h2']])('reads podium %s independently', async (podiumId, heatId) => {
    state.limitResponses.push({ data: [pointer(podiumId, heatId)], error: null });
    await expect(fetchActiveHeatPointer(null, undefined, podiumId)).resolves.toMatchObject({
      podium_id: podiumId, active_heat_id: heatId,
    });
    expect(state.queryFilters[0]).toContainEqual(['podium_id', podiumId]);
  });

  it('returns null for an absent pointer and for a table error', async () => {
    state.limitResponses.push({ data: [], error: null });
    await expect(fetchActiveHeatPointer(null, undefined, 'A')).resolves.toBeNull();
    state.limitResponses.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(fetchActiveHeatPointer(null, undefined, 'A')).resolves.toBeNull();
  });

  it('falls back to a query without podium_id for the old schema', async () => {
    state.limitResponses.push(
      { data: null, error: { code: '42703', message: 'column active_heat_pointer.podium_id does not exist' } },
      { data: [pointer('A', 'closed_r1_h1')], error: null },
    );
    await expect(fetchActiveHeatPointer(null, 'Open', 'B')).resolves.toMatchObject({ active_heat_id: 'closed_r1_h1' });
    expect(state.queryFilters[0]).toContainEqual(['podium_id', 'B']);
    expect(state.queryFilters[1]).not.toContainEqual(['podium_id', 'B']);
  });

  it('writes the current multi-podium RPC payload exactly', async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    await upsertActiveHeatPointer({
      eventId: 7, eventName: 'Open', podiumId: ' b ', activeHeatId: 'open-r1-h2',
      updatedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(state.rpc).toHaveBeenCalledWith('upsert_active_heat_pointer', {
      p_event_id: 7, p_event_name: 'Open', p_active_heat_id: 'open_r1_h2',
      p_updated_at: '2026-08-06T00:00:00.000Z', p_podium_id: 'B',
    });
  });

  it('falls back to the old RPC signature without podium_id', async () => {
    const missing = { code: 'PGRST202', message: 'upsert_active_heat_pointer function not found in schema cache' };
    state.rpc
      .mockResolvedValueOnce({ data: null, error: missing })
      .mockResolvedValueOnce({ data: null, error: null });
    await upsertActiveHeatPointer({
      eventId: 7, eventName: 'Open', podiumId: 'B', activeHeatId: 'open_r1_h2',
      updatedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(state.rpc.mock.calls[1]).toEqual(['upsert_active_heat_pointer', {
      p_event_id: 7, p_event_name: 'Open', p_active_heat_id: 'open_r1_h2',
      p_updated_at: '2026-08-06T00:00:00.000Z',
    }]);
  });

  it('keeps the table fallback without podium column for a legacy schema', async () => {
    const missing = { code: 'PGRST202', message: 'upsert_active_heat_pointer function not found in schema cache' };
    state.rpc.mockResolvedValue({ data: null, error: missing });
    state.limitResponses.push(
      { data: null, error: { code: '42703', message: 'column active_heat_pointer.podium_id does not exist' } },
      { data: [], error: null },
    );
    await upsertActiveHeatPointer({
      eventId: 7, eventName: 'Open', podiumId: 'B', activeHeatId: 'open_r1_h2',
      updatedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(state.inserts).toEqual([{
      event_id: 7, event_name: 'Open', active_heat_id: 'open_r1_h2',
      updated_at: '2026-08-06T00:00:00.000Z',
    }]);
  });

  it('keeps event-id support hint key and invalid event-id behavior', async () => {
    state.limitResponses.push({ data: [pointer('A', 'open_r1_h1')], error: null });
    await fetchActiveHeatPointer(7, undefined, 'A');
    expect(window.localStorage.getItem('active_heat_pointer_event_id_upsert_support')).toContain('"supported":true');
    state.limitResponses.push({ data: [], error: null });
    await fetchActiveHeatPointer(Number.NaN, undefined, 'A');
    expect(state.queryFilters.at(-1)).not.toContainEqual(['event_id', Number.NaN]);
  });
});
