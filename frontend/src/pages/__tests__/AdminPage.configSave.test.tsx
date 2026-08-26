import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../types';

type HeatMetadataFixture = {
  id: string;
  event_id: number;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  heat_size: number;
  status: string;
  color_order: string[];
  created_at: string;
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const adminInterfaceMock = vi.hoisted(() => ({ props: null as {
  onConfigSaved: (saved: boolean, podiumId?: string) => Promise<void>;
  onConfigChange: (config: AppConfig) => void;
} | null }));

const configStoreMock = vi.hoisted(() => ({
  config: {
    competition: 'Mamelles', division: 'OPEN', round: 1, heatId: 1,
    judges: ['J1', 'J2', 'J3'],
    judgeNames: { J1: 'CHARLES', J2: 'J1MAIMOUNA', J3: 'JKHADIJA' },
    judgeIdentities: {
      J1: '5164895e-51e9-42f2-9583-80a3e36cc435',
      J2: '442df135-52cb-4037-895f-5a174de825ca',
      J3: 'c724401b-46ba-4b3e-8227-d8c46110eb2e',
    },
    surfers: ['ROUGE', 'BLANC', 'JAUNE'],
    surferNames: { ROUGE: 'Awa', BLANC: 'Aminata', JAUNE: 'Fatou' },
    surferCountries: { ROUGE: 'SN', BLANC: 'SN', JAUNE: 'SN' },
    waves: 15, tournamentType: 'elimination',
    surfersPerHeat: 3, totalSurfers: 3, totalHeats: 1, totalRounds: 1,
  } as AppConfig,
  setConfig: vi.fn(),
  configSaved: false,
  setConfigSaved: vi.fn(),
  persistConfig: vi.fn(),
  activeEventId: 10,
  availableDivisions: ['OPEN'],
  loadedFromDb: true,
  loadConfigFromDb: vi.fn(async () => undefined),
  setActiveEventId: vi.fn(),
}));

const judgingStoreMock = vi.hoisted(() => ({
  scores: [] as unknown[],
  judgeWorkCount: {},
  setJudgeWorkCount: vi.fn(),
  overrideLogs: [] as unknown[],
  heatStatus: 'waiting',
  timer: { isRunning: false, startTime: null, duration: 20 },
  setTimer: vi.fn(),
  setHeatStatus: vi.fn(),
  setScores: vi.fn(),
}));

const timerHookMock = vi.hoisted(() => (({
  timer: { isRunning: false, startTime: null, duration: 20 },
  setTimer: vi.fn(),
  setDuration: vi.fn(),
})));

const heatManagerMock = vi.hoisted(() => ({ closeHeat: vi.fn(async () => undefined) }));

const realtimeSyncMock = vi.hoisted(() => ({
  publishConfigUpdate: vi.fn(async () => undefined),
  publishTimerStart: vi.fn(async () => undefined),
  publishTimerPause: vi.fn(async () => undefined),
  publishTimerReset: vi.fn(async () => undefined),
  subscribeToHeat: vi.fn(() => () => undefined),
}));

const scoreManagerMock = vi.hoisted(() => ({ handleScoreOverride: vi.fn(async () => undefined) }));

const supabaseSyncMock = vi.hoisted(() => ({
  createHeat: vi.fn(async () => ({ id: 'mamelles_open_benjamin_r1_h1' })),
  saveHeatConfig: vi.fn(async () => undefined),
  loadHeatConfig: vi.fn(async () => null),
}));

const eventsApiMock = vi.hoisted(() => ({
  updateEventConfiguration: vi.fn(async () => undefined),
  saveEventConfigSnapshot: vi.fn(async () => undefined),
}));

const heatsApiMock = vi.hoisted(() => ({
  fetchOrderedHeatSequence: vi.fn(async () => []),
  fetchHeatBySchedule: vi.fn(async () => ({ id: 'mamelles_open_r1_h1' })),
  fetchHeatMetadata: vi.fn(async (): Promise<HeatMetadataFixture | null> => ({
    id: 'mamelles_open_r1_h1',
    event_id: 10,
    competition: 'Mamelles',
    division: 'OPEN',
    round: 1,
    heat_number: 1,
    heat_size: 3,
    status: 'open',
    color_order: ['RED', 'WHITE', 'YELLOW'],
    created_at: '2026-08-10T21:00:46.034689Z',
  })),
}));

const heatParticipantsMock = vi.hoisted(() => ({ useHeatParticipants: vi.fn(() => ({ participants: {} })) }));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}));

vi.mock('../../components/AdminInterface', () => ({
  default: (props: unknown) => {
    adminInterfaceMock.props = props as typeof adminInterfaceMock.props;
    return null;
  },
}));

vi.mock('../../stores/configStore', () => ({ useConfigStore: () => configStoreMock }));
vi.mock('../../stores/judgingStore', () => ({ useJudgingStore: () => judgingStoreMock }));
vi.mock('../../hooks/useCompetitionTimer', () => ({ useCompetitionTimer: () => timerHookMock }));
vi.mock('../../hooks/useHeatManager', () => ({ useHeatManager: () => heatManagerMock }));
vi.mock('../../hooks/useRealtimeSync', () => ({ useRealtimeSync: () => realtimeSyncMock }));
vi.mock('../../hooks/useScoreManager', () => ({ useScoreManager: () => scoreManagerMock }));
vi.mock('../../hooks/useSupabaseSync', () => ({ useSupabaseSync: () => supabaseSyncMock }));
vi.mock('../../hooks/useHeatParticipants', () => heatParticipantsMock);



vi.mock('../../utils/heatWorkflow', () => ({
  resolveEventIdForHeat: vi.fn(async () => 10),
}));

vi.mock('../../api/modules/events.api', () => eventsApiMock);

vi.mock('../../api/modules/heats.api', () => heatsApiMock);

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  canUseSupabaseConnection: () => true,
}));

vi.mock('../../utils/secureStorage', () => ({
  getSafeLocalStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import AdminPage from '../AdminPage';

describe('TEST A — AdminPage.handleConfigSaved ne laisse jamais configSaved=true si la persistance critique échoue', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    configStoreMock.configSaved = false;
    configStoreMock.config.surfers = ['ROUGE', 'BLANC', 'JAUNE'];
    heatsApiMock.fetchHeatMetadata.mockResolvedValue({
      id: 'mamelles_open_r1_h1',
      event_id: 10,
      competition: 'Mamelles',
      division: 'OPEN',
      round: 1,
      heat_number: 1,
      heat_size: 3,
      status: 'open',
      color_order: ['RED', 'WHITE', 'YELLOW'],
      created_at: '2026-08-10T21:00:46.034689Z',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderAdmin = async () => {
    await act(async () => {
      root.render(<AdminPage />);
    });
    expect(adminInterfaceMock.props).not.toBeNull();
    return adminInterfaceMock.props!.onConfigSaved;
  };

  it.each([
    [{ code: '23503', message: 'Heat not found' }, '23503'],
    [{ code: '42501', message: 'Access denied' }, '42501'],
    [{ code: 'PGRST202', message: 'Function not found' }, 'PGRST202'],
    [new TypeError('Failed to fetch'), undefined],
  ])('erreur %s → configSaved=false et erreur remontée à AdminInterface', async (error, code) => {
    supabaseSyncMock.saveHeatConfig.mockRejectedValueOnce(error);

    const handleConfigSaved = await renderAdmin();

    if (code) {
      await expect(handleConfigSaved(true, 'A')).rejects.toMatchObject({ code });
    } else {
      await expect(handleConfigSaved(true, 'A')).rejects.toThrow('Failed to fetch');
    }
    expect(configStoreMock.setConfigSaved).toHaveBeenCalledWith(false);
    expect(configStoreMock.setConfigSaved).not.toHaveBeenCalledWith(true);
    expect(configStoreMock.persistConfig).not.toHaveBeenCalled();
    expect(realtimeSyncMock.publishConfigUpdate).not.toHaveBeenCalled();
  });

  it('heat planifié existant → aucune écriture events/heats directe et succès seulement après la persistance canonique', async () => {
    const order: string[] = [];
    configStoreMock.setConfigSaved.mockImplementation((saved: boolean) => order.push(`saved:${saved}`));
    supabaseSyncMock.saveHeatConfig.mockImplementation(async () => { order.push('canonical'); });
    realtimeSyncMock.publishConfigUpdate.mockImplementation(async () => { order.push('realtime'); });
    configStoreMock.persistConfig.mockImplementation(() => { order.push('local'); });

    const handleConfigSaved = await renderAdmin();
    await expect(handleConfigSaved(true, 'A')).resolves.toBeUndefined();

    expect(heatsApiMock.fetchHeatMetadata).toHaveBeenCalledWith('mamelles_open_r1_h1');
    expect(eventsApiMock.updateEventConfiguration).not.toHaveBeenCalled();
    expect(eventsApiMock.saveEventConfigSnapshot).not.toHaveBeenCalled();
    expect(supabaseSyncMock.createHeat).not.toHaveBeenCalled();
    expect(supabaseSyncMock.saveHeatConfig).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['saved:false', 'canonical', 'saved:true', 'realtime', 'local']);
  });

  it('heat planifié absent → erreur explicite, aucun SAVE canonique et aucun faux succès', async () => {
    heatsApiMock.fetchHeatMetadata.mockResolvedValueOnce(null);

    const handleConfigSaved = await renderAdmin();

    await expect(handleConfigSaved(true, 'A')).rejects.toThrow('Heat planifié introuvable');
    expect(configStoreMock.setConfigSaved).toHaveBeenCalledWith(false);
    expect(configStoreMock.setConfigSaved).not.toHaveBeenCalledWith(true);
    expect(supabaseSyncMock.createHeat).not.toHaveBeenCalled();
    expect(supabaseSyncMock.saveHeatConfig).not.toHaveBeenCalled();
    expect(realtimeSyncMock.publishConfigUpdate).not.toHaveBeenCalled();
    expect(configStoreMock.persistConfig).not.toHaveBeenCalled();
  });

  it('sélection manuelle d’un heat existant → hydrate sa configuration canonique, sans dépendre de event_last_config', async () => {
    supabaseSyncMock.loadHeatConfig.mockResolvedValueOnce({
      heat_id: 'mamelles_open_r1_h1',
      judges: ['J1', 'J2', 'J3'],
      surfers: ['ROUGE', 'BLANC', 'JAUNE'],
      judge_names: { J1: 'Charles', J2: 'Maimouna', J3: 'Khadija' },
      judge_identities: { J1: 'judge-1', J2: 'judge-2', J3: 'judge-3' },
      waves: 15,
      tournament_type: 'elimination',
    });

    await renderAdmin();
    await act(async () => { await Promise.resolve(); });

    expect(supabaseSyncMock.loadHeatConfig).toHaveBeenCalledWith('mamelles_open_r1_h1');
    expect(configStoreMock.setConfigSaved).toHaveBeenCalledWith(true);
    const update = configStoreMock.setConfig.mock.calls[0]?.[0] as (current: AppConfig) => AppConfig;
    expect(update(configStoreMock.config)).toEqual(expect.objectContaining({
      judges: ['J1', 'J2', 'J3'],
      surfers: ['ROUGE', 'BLANC', 'JAUNE'],
      judgeNames: { J1: 'Charles', J2: 'Maimouna', J3: 'Khadija' },
      judgeIdentities: { J1: 'judge-1', J2: 'judge-2', J3: 'judge-3' },
    }));
  });

  it('refresh canonique RED/WHITE/YELLOW → normalisation UI ROUGE/BLANC/JAUNE ne rend pas la config dirty', async () => {
    configStoreMock.configSaved = true;
    configStoreMock.config.surfers = ['RED', 'WHITE', 'YELLOW'];
    configStoreMock.config.surferNames = {
      RED: 'Awa', WHITE: 'Aminata', YELLOW: 'Fatou',
      ROUGE: 'Awa', BLANC: 'Aminata', JAUNE: 'Fatou',
    };
    configStoreMock.config.surferCountries = {
      RED: 'SN', WHITE: 'SN', YELLOW: 'SN',
      ROUGE: 'SN', BLANC: 'SN', JAUNE: 'SN',
    };

    await renderAdmin();
    act(() => {
      adminInterfaceMock.props!.onConfigChange({
        ...configStoreMock.config,
        surfers: ['ROUGE', 'BLANC', 'JAUNE'],
        surferNames: { ROUGE: 'Awa', BLANC: 'Aminata', JAUNE: 'Fatou' },
        surferCountries: { ROUGE: 'SN', BLANC: 'SN', JAUNE: 'SN' },
      });
    });

    expect(configStoreMock.setConfigSaved).not.toHaveBeenCalledWith(false);
  });
});
