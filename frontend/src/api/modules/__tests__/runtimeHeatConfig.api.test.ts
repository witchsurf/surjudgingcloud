import { describe, expect, it, vi } from 'vitest';
import { replayLegacyRuntimeHeatConfig, upsertRuntimeHeatConfig } from '../runtimeHeatConfig.api';

describe('runtime heat config RPC adapter', () => {
  it('preserves the historical six-column payload', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await upsertRuntimeHeatConfig({ rpc } as never, {
      heat_id: 'heat_1', judges: ['J1', 'J2', 'J3'], surfers: ['ROUGE', 'BLANC'],
      judge_names: { J1: 'Judge One' }, waves: 12, tournament_type: 'elimination',
    });
    expect(rpc).toHaveBeenCalledWith('upsert_heat_config_runtime', {
      p_heat_id: 'heat_1', p_judges: ['J1', 'J2', 'J3'], p_surfers: ['ROUGE', 'BLANC'],
      p_judge_names: { J1: 'Judge One' }, p_waves: 12, p_tournament_type: 'elimination',
    });
  });

  it('propagates the RPC error unchanged', async () => {
    const error = { code: '42501', message: 'Access denied' };
    const rpc = vi.fn(async () => ({ data: null, error }));
    await expect(upsertRuntimeHeatConfig({ rpc } as never, {
      heat_id: 'heat_1', judges: [], surfers: [], judge_names: {}, waves: 15,
      tournament_type: 'elimination',
    })).rejects.toBe(error);
  });

  it('replays the persisted snake_case queue payload unchanged and idempotently', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { rpc } as never;
    const persisted = {
      rows: {
        heat_id: 'heat_legacy', judges: ['J1', 'J2', 'J3'], surfers: ['ROUGE'],
        judge_names: { J1: 'One' }, waves: 15, tournament_type: 'elimination',
      },
      options: { onConflict: 'heat_id' },
    };
    await replayLegacyRuntimeHeatConfig(client, persisted);
    await replayLegacyRuntimeHeatConfig(client, persisted);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc).toHaveBeenLastCalledWith('upsert_heat_config_runtime', expect.objectContaining({
      p_heat_id: 'heat_legacy', p_waves: 15,
    }));
  });
});
