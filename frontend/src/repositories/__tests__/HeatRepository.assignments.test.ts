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
import type { HeatConfigurationRequest } from '../contracts';

type TestRepository = {
  supabase: unknown;
  execute: <T>(operation: () => Promise<T>, fallback?: () => T | Promise<T>) => Promise<T>;
  ensureHeatEntries: (heatId: string, config: unknown) => Promise<void>;
  ensureEventLastConfigSnapshot: (heatId: string, config: unknown, assignments: unknown[]) => Promise<void>;
  saveConfiguration: HeatRepository['saveConfiguration'];
  saveHeatConfig: HeatRepository['saveHeatConfig'];
};

const asTestRepository = (repository: HeatRepository) => repository as unknown as TestRepository;

const heatId = 'mamelles_open_benjamin_r1_h1';

const OFFICIAL_PANEL = {
  judges: ['J1', 'J2', 'J3'] as const,
  judgeNames: { J1: 'CHARLES', J2: 'J1MAIMOUNA', J3: 'JKHADIJA' } as Record<string, string>,
  judgeIdentities: {
    J1: '5164895e-51e9-42f2-9583-80a3e36cc435',
    J2: '442df135-52cb-4037-895f-5a174de825ca',
    J3: 'c724401b-46ba-4b3e-8227-d8c46110eb2e',
  } as Record<string, string>,
};

const buildRequest = (eventId: number | null, podiumId = 'A'): HeatConfigurationRequest => ({
  eventId,
  judges: [...OFFICIAL_PANEL.judges],
  surfers: ['ROUGE', 'BLANC', 'JAUNE'],
  judgeNames: { ...OFFICIAL_PANEL.judgeNames },
  judgeIdentities: { ...OFFICIAL_PANEL.judgeIdentities },
  surferNames: { ROUGE: 'Awa', BLANC: 'Aminata', JAUNE: 'Fatou' },
  surferCountries: { ROUGE: 'SN', BLANC: 'SN', JAUNE: 'SN' },
  waves: 15,
  tournamentType: 'elimination',
  podiumId,
});
/** Fake Supabase client that records the heat_judge_assignments payloads and rejects any DELETE. */
const buildSupabaseMock = () => {
  const assignmentPayloads: Array<Array<Record<string, unknown>>> = [];
  const from = vi.fn((table: string) => {
    if (table === 'heat_judge_assignments') {
      return {
        upsert: async (rows: Array<Record<string, unknown>>) => {
          assignmentPayloads.push(rows);
          return { error: null, data: null };
        },
        delete: async () => {
          throw new Error(`DELETE inattendu sur ${table}`);
        },
      };
    }
    return { upsert: async () => ({ error: null, data: null }) };
  });
  return { from, assignmentPayloads };
};

describe('HeatRepository — persistance des affectations juges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TEST B — event_id: null ne doit jamais devenir 0 (piège Number(null))', () => {
    it('saveConfiguration(eventId: null) transmet event_id: null dans chaque ligne heat_judge_assignments', async () => {
      const repository = asTestRepository(new HeatRepository());
      repository.execute = async (operation) => operation();
      const supabaseMock = buildSupabaseMock();
      repository.supabase = { from: supabaseMock.from };
      repository.ensureHeatEntries = vi.fn(async () => undefined);
      repository.ensureEventLastConfigSnapshot = vi.fn(async () => undefined);

      await repository.saveConfiguration(heatId, buildRequest(null, 'B'));

      expect(supabaseMock.assignmentPayloads).toHaveLength(1);
      const rows = supabaseMock.assignmentPayloads[0];
      expect(rows).toHaveLength(3);
      rows.forEach((row) => {
        expect(row.event_id).toBeNull();
      });
    });
  });

  describe('TEST C — happy path complet événement 10', () => {
    it('chaîne RPC → heat_judge_assignments.upsert → entries → event snapshot (podium A)', async () => {
      const repository = asTestRepository(new HeatRepository());
      repository.execute = async (operation) => operation();
      const supabaseMock = buildSupabaseMock();
      repository.supabase = { from: supabaseMock.from };
      const ensureHeatEntries = vi.fn(async () => undefined);
      const ensureSnapshot = vi.fn(async () => undefined);
      repository.ensureHeatEntries = ensureHeatEntries;
      repository.ensureEventLastConfigSnapshot = ensureSnapshot;

      await repository.saveConfiguration(heatId, buildRequest(10, 'A'));

      // 1 appel RPC
      expect(runtimeConfigApi.upsertRuntimeHeatConfig).toHaveBeenCalledTimes(1);
      expect(runtimeConfigApi.upsertRuntimeHeatConfig).toHaveBeenCalledWith(
        { from: supabaseMock.from },
        expect.objectContaining({ heat_id: heatId }),
      );

      // 1 seul upsert heat_judge_assignments avec exactement 3 lignes officielles
      expect(supabaseMock.assignmentPayloads).toHaveLength(1);
      const rows = supabaseMock.assignmentPayloads[0];
      expect(rows).toEqual([
        { heat_id: heatId, event_id: 10, station: 'J1', judge_id: '5164895e-51e9-42f2-9583-80a3e36cc435', judge_name: 'CHARLES' },
        { heat_id: heatId, event_id: 10, station: 'J2', judge_id: '442df135-52cb-4037-895f-5a174de825ca', judge_name: 'J1MAIMOUNA' },
        { heat_id: heatId, event_id: 10, station: 'J3', judge_id: 'c724401b-46ba-4b3e-8227-d8c46110eb2e', judge_name: 'JKHADIJA' },
      ]);

      // aucune écriture offline, aucune suppression
      expect(supabaseLib.saveOffline).not.toHaveBeenCalled();

      // étapes suivantes exécutées
      expect(ensureHeatEntries).toHaveBeenCalledTimes(1);
      expect(ensureSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe('TEST D — échec RPC bloque toutes les étapes juges et rejette', () => {
    it('upsertRuntimeHeatConfig throw 23503 → aucun upsert, aucune entrée, aucun snapshot, rejet explicite', async () => {
      const repository = asTestRepository(new HeatRepository());
      const supabaseMock = buildSupabaseMock();
      repository.supabase = { from: supabaseMock.from };
      const ensureHeatEntries = vi.fn(async () => undefined);
      const ensureSnapshot = vi.fn(async () => undefined);
      repository.ensureHeatEntries = ensureHeatEntries;
      repository.ensureEventLastConfigSnapshot = ensureSnapshot;

      runtimeConfigApi.upsertRuntimeHeatConfig.mockRejectedValueOnce({ code: '23503', message: 'Heat not found' });

      await expect(repository.saveConfiguration(heatId, buildRequest(10, 'A')))
        .rejects.toMatchObject({ code: '23503' });

      expect(runtimeConfigApi.upsertRuntimeHeatConfig).toHaveBeenCalledTimes(1);
      expect(supabaseMock.assignmentPayloads).toHaveLength(0);
      expect(ensureHeatEntries).not.toHaveBeenCalled();
      expect(ensureSnapshot).not.toHaveBeenCalled();
      expect(supabaseLib.saveOffline).not.toHaveBeenCalled();
    });
  });
});
