import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchAllEventHeats: vi.fn(), fetchCategoryHeats: vi.fn(),
  fetchHeatEntriesWithParticipants: vi.fn(), fetchHeatEntriesWithParticipantsBatch: vi.fn(),
  fetchHeatMetadata: vi.fn(), fetchHeatSlotMappings: vi.fn(), fetchHeatSlotMappingsBatch: vi.fn(),
  fetchOrderedHeatSequence: vi.fn(), replaceHeatEntries: vi.fn(), adminOverrideHeatEntry: vi.fn(),
  activateHeatOnPodium: vi.fn(async () => ({})),
}));
const supabaseLib = vi.hoisted(() => ({
  supabase: null, isSupabaseConfigured: vi.fn(() => true), canUseSupabaseConnection: vi.fn(() => true),
  saveOffline: vi.fn(),
}));
const runtimeConfigApi = vi.hoisted(() => ({ upsertRuntimeHeatConfig: vi.fn(async () => undefined) }));
vi.mock('../../api/modules/heats.api', () => api);
vi.mock('../../lib/supabase', () => supabaseLib);
vi.mock('../../api/modules/runtimeHeatConfig.api', () => runtimeConfigApi);

import { HeatRepository } from '../HeatRepository';

type TestRepository = {
  supabase: unknown;
  execute: <T>(operation: () => Promise<T>, fallback?: () => T | Promise<T>) => Promise<T>;
  ensureHeatEntries: (heatId: string, config: unknown) => Promise<void>;
  ensureEventLastConfigSnapshot: (heatId: string, config: unknown, assignments: unknown[]) => Promise<void>;
  saveHeatConfig: (heatId: string, config: any) => Promise<void>;
  createRuntime: (request: any) => Promise<void>;
};

const asTestRepository = (repository: HeatRepository) => repository as unknown as TestRepository;

describe('HeatRepository non-destructive mutation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([3, 5])('saveConfiguration preserves the canonical panel %s payload', async (judgeCount) => {
    const repository = new HeatRepository();
    const legacy = vi.spyOn(repository, 'saveHeatConfig').mockResolvedValue();
    const judges = Array.from({ length: judgeCount }, (_, index) => `J${index + 1}`);
    await repository.saveConfiguration('heat-1', {
      eventId: 7, judges, surfers: ['ROUGE', 'BLANC', 'JAUNE'],
      judgeNames: Object.fromEntries(judges.map((station) => [station, station])),
      judgeIdentities: Object.fromEntries(judges.map((station) => [station, `id-${station}`])),
      surferNames: { ROUGE: 'Awa' }, surferCountries: { ROUGE: 'SN' },
      waves: 12, tournamentType: 'elimination', podiumId: 'A',
    });
    expect(legacy).toHaveBeenCalledWith('heat-1', {
      event_id: 7, judges, surfers: ['ROUGE', 'BLANC', 'JAUNE'],
      judge_names: Object.fromEntries(judges.map((station) => [station, station])),
      judge_identities: Object.fromEntries(judges.map((station) => [station, `id-${station}`])),
      surfer_names: { ROUGE: 'Awa' }, surfer_countries: { ROUGE: 'SN' },
      waves: 12, tournament_type: 'elimination', podiumId: 'A',
    });
  });

  it('keeps nominal save order: config, assignments, entries, event snapshot', async () => {
    const repository = asTestRepository(new HeatRepository());
    const order: string[] = [];
    repository.execute = async (operation) => operation();
    repository.supabase = {
      from: (table: string) => ({
        upsert: async () => {
          order.push(table);
          return { error: null };
        },
      }),
    };
    runtimeConfigApi.upsertRuntimeHeatConfig.mockImplementationOnce(async () => { order.push('heat_configs'); });
    repository.ensureHeatEntries = vi.fn(async () => { order.push('heat_entries'); });
    repository.ensureEventLastConfigSnapshot = vi.fn(async () => { order.push('event_snapshot'); });

    await repository.saveHeatConfig('heat-1', {
      event_id: 7, judges: ['J1', 'J2', 'J3'], surfers: ['ROUGE'],
      judge_names: { J1: 'One', J2: 'Two', J3: 'Three' },
      judge_identities: { J1: 'one', J2: 'two', J3: 'three' }, podiumId: 'A',
    });
    expect(order).toEqual(['heat_configs', 'heat_judge_assignments', 'heat_entries', 'event_snapshot']);
    expect(runtimeConfigApi.upsertRuntimeHeatConfig).toHaveBeenCalledWith(repository.supabase, {
      heat_id: 'heat-1', judges: ['J1', 'J2', 'J3'], surfers: ['ROUGE'],
      judge_names: { J1: 'One', J2: 'Two', J3: 'Three' }, waves: 15,
      tournament_type: 'elimination',
    });
  });

  it('keeps the existing offline queue tables, payloads and order', async () => {
    const repository = asTestRepository(new HeatRepository());
    repository.execute = async (_operation, fallback) => {
      if (!fallback) throw new Error('fallback absent');
      return fallback();
    };
    await repository.saveHeatConfig('heat-1', {
      event_id: 7, judges: ['J1', 'J2', 'J3'], surfers: ['ROUGE'],
      judge_names: {}, judge_identities: { J1: 'one', J2: 'two', J3: 'three' },
    });
    expect(supabaseLib.saveOffline.mock.calls.map(([operation]) => operation.table)).toEqual([
      'heat_configs', 'heat_judge_assignments', '__heat_config_repair__',
    ]);
    expect(supabaseLib.saveOffline.mock.calls[0][0]).toMatchObject({
      action: 'upsert', payload: { rows: { heat_id: 'heat-1', surfers: ['ROUGE'] } },
    });
  });

  it('delegates replace entries with the unchanged snake_case persistence payload', async () => {
    const repository = new HeatRepository();
    await repository.replaceEntries('heat-1', [{ position: 1, participantId: 42, seed: 1, color: 'ROUGE' }]);
    expect(api.replaceHeatEntries).toHaveBeenCalledWith('heat-1', [{
      position: 1, participant_id: 42, seed: 1, color: 'ROUGE',
    }]);
  });

  it('overrides the ROUGE participant without any scoring write', async () => {
    api.adminOverrideHeatEntry.mockResolvedValue({
      heat_id: 'heat-1', position: 1, color: 'ROUGE', participant_id: 99,
      name: 'Nouvelle identité', country: 'SN', config_patch: { surfer_names: { ROUGE: 'Nouvelle identité' } },
    });
    const repository = new HeatRepository();
    const result = await repository.overrideEntry({
      heatId: 'heat-1', position: 1, color: 'ROUGE', participantId: 99,
      reason: 'Correction', createdBy: 'chief',
    });
    expect(api.adminOverrideHeatEntry).toHaveBeenCalledWith({
      heatId: 'heat-1', position: 1, color: 'ROUGE', participantId: 99,
      reason: 'Correction', createdBy: 'chief',
    });
    expect(result).toMatchObject({ heatId: 'heat-1', color: 'ROUGE', participantId: 99 });
    expect(Object.keys(api)).not.toContain('saveScore');
  });

  it('propagates adapter errors unchanged', async () => {
    const error = new Error('RPC admin_override_heat_entry indisponible');
    api.adminOverrideHeatEntry.mockRejectedValue(error);
    await expect(new HeatRepository().overrideEntry({ heatId: 'heat-1', position: 1 }))
      .rejects.toBe(error);
  });

  it('keeps runtime heat upsert payload and offline fallback unchanged', async () => {
    const request = {
      id: 'event_open_r1_h1', eventId: 7, competition: 'Event', division: 'OPEN',
      round: 1, heatNumber: 1, status: 'waiting', createdAt: '2026-08-08T12:00:00.000Z',
    };
    const expected = {
      id: request.id, event_id: 7, competition: 'Event', division: 'OPEN',
      round: 1, heat_number: 1, status: 'waiting', created_at: request.createdAt,
    };

    const online = asTestRepository(new HeatRepository());
    const upsert = vi.fn(async () => ({ error: null }));
    online.execute = async (operation) => operation();
    online.supabase = { from: vi.fn(() => ({ upsert })) };
    await online.createRuntime(request);
    expect(upsert).toHaveBeenCalledWith(expected, { onConflict: 'id' });

    const offline = asTestRepository(new HeatRepository());
    offline.execute = async (_operation, fallback) => fallback!();
    await offline.createRuntime(request);
    expect(supabaseLib.saveOffline).toHaveBeenLastCalledWith(expect.objectContaining({
      table: 'heats', action: 'upsert', payload: { rows: expected, options: { onConflict: 'id' } },
    }));
  });
});
