import { beforeEach, describe, expect, it, vi } from 'vitest';

type Response = { data?: unknown; error: unknown };
const state = vi.hoisted(() => ({
  responses: [] as Response[],
  operations: [] as Array<{ table: string; operation: string; payload?: unknown; filters: unknown[] }>,
  rpc: vi.fn(),
}));

const makeQuery = (table: string) => {
  const record = { table, operation: 'query', payload: undefined as unknown, filters: [] as unknown[] };
  state.operations.push(record);
  const query: Record<string, unknown> & PromiseLike<Response> = {
    select: vi.fn(() => { record.operation = 'select'; return query; }),
    upsert: vi.fn((payload: unknown) => { record.operation = 'upsert'; record.payload = payload; return query; }),
    delete: vi.fn(() => { record.operation = 'delete'; return query; }),
    eq: vi.fn((field: string, value: unknown) => { record.filters.push(['eq', field, value]); return query; }),
    in: vi.fn((field: string, value: unknown) => { record.filters.push(['in', field, value]); return query; }),
    then: (resolve: (value: Response) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(state.responses.shift() ?? { data: null, error: null }).then(resolve, reject),
  };
  return query;
};

vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc: state.rpc, from: vi.fn((table: string) => makeQuery(table)) },
  isSupabaseConfigured: () => true,
}));

import { createHeatsWithEntries, deletePlannedHeats } from '../heats.api';
import type { ParticipantRecord } from '../../../repositories/contracts';

const participants = () => new Map<number, ParticipantRecord>([
  [1, { id: 101, eventId: 7, category: 'Open Men', seed: 1, name: 'Seed One', country: 'SN', license: 'L1' }],
  [2, { id: 102, eventId: 7, category: 'Open Men', seed: 2, name: 'Seed Two', country: 'FR', license: 'L2' }],
  [3, { id: 103, eventId: 7, category: 'Open Men', seed: 3, name: 'Seed Three', country: null, license: null }],
]);

const rounds = [{
  name: 'Round 1', roundNumber: 1,
  heats: [{ heatNumber: 1, slots: [{ seed: 1 }, { seed: 2 }, { seed: 3 }] }],
}];

describe('heat planning safe adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.responses.length = 0;
    state.operations.length = 0;
    state.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('preserves participants, seeds, categories, color_order, RPC payload and heat_configs', async () => {
    state.responses.push(
      { error: null },
      { data: [{ id: 101, seed: 1 }, { id: 102, seed: 2 }, { id: 103, seed: 3 }], error: null },
    );

    const result = await createHeatsWithEntries(7, 'Open', 'Open Men', rounds, participants(), {
      defaultJudges: ['J1', 'J2', 'J3'], tournamentType: 'elimination',
    });

    expect(result.heats[0]).toMatchObject({ event_id: 7, division: 'Open Men', color_order: ['RED', 'WHITE', 'YELLOW'] });
    expect(result.entries.map((entry) => [entry.seed, entry.participant_id, entry.color])).toEqual([
      [1, 101, 'RED'], [2, 102, 'WHITE'], [3, 103, 'YELLOW'],
    ]);
    expect(state.operations[0]).toMatchObject({ table: 'participants', operation: 'upsert' });
    expect(state.operations[0].payload).toEqual([
      { event_id: 7, category: 'Open Men', seed: 1, name: 'Seed One', country: 'SN', license: 'L1' },
      { event_id: 7, category: 'Open Men', seed: 2, name: 'Seed Two', country: 'FR', license: 'L2' },
      { event_id: 7, category: 'Open Men', seed: 3, name: 'Seed Three', country: null, license: null },
    ]);
    expect(result.heats[0]).toMatchObject({ is_active: false });
    expect(state.rpc).toHaveBeenCalledWith('bulk_upsert_heats_safe_v2', expect.objectContaining({
      p_heats: result.heats,
      p_entries: result.entries,
      p_event_id: 7,
      p_category: 'Open Men',
      p_overwrite: false,
      p_heat_configs: [expect.objectContaining({
        heat_id: result.heats[0].id,
        judges: ['J1', 'J2', 'J3'],
        judge_names: {},
        surfers: ['ROUGE', 'BLANC', 'JAUNE'],
        waves: 15,
        tournament_type: 'elimination',
      })],
    }));
    expect(state.operations.some((operation) => operation.table === 'heat_configs')).toBe(false);
    expect(state.operations.some((operation) => operation.table === 'scores')).toBe(false);
  });

  it('delegates overwrite=true to the atomic RPC without a client-side destructive read', async () => {
    state.responses.push(
      { error: null },
      { data: [{ id: 101, seed: 1 }, { id: 102, seed: 2 }, { id: 103, seed: 3 }], error: null },
    );
    await createHeatsWithEntries(7, 'Open', 'Open Men', rounds, participants(), { overwrite: true });
    expect(state.rpc).toHaveBeenCalledWith('bulk_upsert_heats_safe_v2', expect.objectContaining({ p_overwrite: true }));
    expect(state.operations.some((operation) => operation.table === 'heats')).toBe(false);
  });

  it('propagates the bulk RPC error and does not create heat_configs afterwards', async () => {
    state.responses.push(
      { error: null },
      { data: [{ id: 101, seed: 1 }, { id: 102, seed: 2 }, { id: 103, seed: 3 }], error: null },
    );
    const error = Object.assign(new Error('bulk denied'), { code: '42501' });
    state.rpc.mockResolvedValue({ data: null, error });
    await expect(createHeatsWithEntries(7, 'Open', 'Open Men', rounds, participants())).rejects.toBe(error);
    expect(state.operations.some((operation) => operation.table === 'heat_configs')).toBe(false);
  });

  it('fails closed when the safe RPC is unavailable and never falls back to legacy bulk', async () => {
    state.responses.push(
      { error: null },
      { data: [{ id: 101, seed: 1 }, { id: 102, seed: 2 }, { id: 103, seed: 3 }], error: null },
    );
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'bulk_upsert_heats_safe_v2 not found' } });
    await expect(createHeatsWithEntries(7, 'Open', 'Open Men', rounds, participants())).rejects.toEqual(
      expect.objectContaining({ code: 'PGRST202' }),
    );
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).not.toHaveBeenCalledWith('bulk_upsert_heats', expect.anything());
    expect(state.rpc).not.toHaveBeenCalledWith('bulk_upsert_heats_safe', expect.anything());
    expect(state.operations.some((operation) => operation.table === 'heat_configs')).toBe(false);
  });

  it('deletePlannedHeats deletes entries then only planned/open heat IDs', async () => {
    state.responses.push(
      { data: [{ id: 'planned-1' }, { id: 'open-2' }], error: null },
      { error: null },
      { error: null },
    );
    await deletePlannedHeats(7, 'Open Men');
    expect(state.operations.map(({ table, operation }) => [table, operation])).toEqual([
      ['heats', 'select'], ['heat_entries', 'delete'], ['heats', 'delete'],
    ]);
    expect(state.operations[0].filters).toContainEqual(['in', 'status', ['planned', 'open']]);
    expect(state.operations[1].filters).toContainEqual(['in', 'heat_id', ['planned-1', 'open-2']]);
    expect(state.operations[2].filters).toContainEqual(['in', 'id', ['planned-1', 'open-2']]);
  });

  it('does not delete anything when no planned/open heat exists', async () => {
    state.responses.push({ data: [], error: null });
    await deletePlannedHeats(7, 'Open Men');
    expect(state.operations).toHaveLength(1);
  });

  it('preserves delete error behavior: entry error is ignored, heat delete error is propagated', async () => {
    const heatDeleteError = Object.assign(new Error('heat delete denied'), { code: '42501' });
    state.responses.push(
      { data: [{ id: 'planned-1' }], error: null },
      { error: { code: '42501', message: 'entry delete denied' } },
      { error: heatDeleteError },
    );
    await expect(deletePlannedHeats(7, 'Open Men')).rejects.toBe(heatDeleteError);
    expect(state.operations.map(({ table, operation }) => [table, operation])).toEqual([
      ['heats', 'select'], ['heat_entries', 'delete'], ['heats', 'delete'],
    ]);
  });
});
