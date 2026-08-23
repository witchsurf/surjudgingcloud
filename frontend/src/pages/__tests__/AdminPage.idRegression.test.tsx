import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const adminInterfaceMock = vi.hoisted(() => ({ props: null as any }));

const configStoreMock = vi.hoisted(() => ({
  config: {
    competition: 'P38-Test2-Disposable', division: 'OPEN', round: 1, heatId: 1,
    judges: ['J1', 'J2', 'J3'],
    judgeNames: { J1: 'Charles', J2: 'Maimouna', J3: 'Khadija' },
    judgeIdentities: {},
    surfers: ['ROUGE', 'BLANC', 'JAUNE'],
    surferNames: {},
    surferCountries: {},
    waves: 15, tournamentType: 'elimination',
    surfersPerHeat: 3, totalSurfers: 3, totalHeats: 1, totalRounds: 1,
  } as AppConfig,
  setConfig: vi.fn(),
  configSaved: true,
  setConfigSaved: vi.fn(),
  persistConfig: vi.fn(),
  activeEventId: 10006,
  availableDivisions: ['OPEN'],
  loadedFromDb: true,
  loadConfigFromDb: vi.fn(async () => undefined),
  setActiveEventId: vi.fn(),
}));

const judgingStoreMock = vi.hoisted(() => ({
  scores: [],
  judgeWorkCount: {},
  setJudgeWorkCount: vi.fn(),
  overrideLogs: [],
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
  createHeat: vi.fn(async () => ({ id: 'new_heat_id' })),
  saveHeatConfig: vi.fn(async () => undefined),
}));

const heatsApiMock = vi.hoisted(() => ({
  fetchOrderedHeatSequence: vi.fn(async () => []),
  fetchHeatBySchedule: vi.fn(async () => ({ id: 'test-authoritative-open-r1-h1' })),
  fetchHeatMetadata: vi.fn(async () => ({
    id: 'test-authoritative-open-r1-h1',
    event_id: 10006,
    competition: 'P38-Test2-Disposable',
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
    adminInterfaceMock.props = props;
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
  resolveEventIdForHeat: vi.fn(async () => 10006),
}));

vi.mock('../../api/modules/events.api', () => ({
  updateEventConfiguration: vi.fn(async () => undefined),
  saveEventConfigSnapshot: vi.fn(async () => undefined),
}));

vi.mock('../../api/modules/heats.api', () => heatsApiMock);

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  canUseSupabaseConnection: () => true,
}));

vi.mock('../../utils/secureStorage', () => ({
  getSafeLocalStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import AdminPage from '../AdminPage';

describe('AdminPage heat ID regression', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses authoritative DB ID for all downstream systems and never falls back to event name ID', async () => {
    await act(async () => {
      root.render(<AdminPage />);
    });

    expect(heatsApiMock.fetchHeatBySchedule).toHaveBeenCalledWith(10006, 'OPEN', 1, 1);

    // Wait for the async ID resolution to settle
    await new Promise(resolve => setTimeout(resolve, 0));

    // Check that canonicalHeatId passed to AdminInterface is the authoritative ID
    expect(adminInterfaceMock.props.canonicalHeatId).toBe('test-authoritative-open-r1-h1');
    expect(adminInterfaceMock.props.canonicalHeatId).not.toContain('p38');

    // Trigger save to ensure we don't save to synthetic ID
    await act(async () => {
      await adminInterfaceMock.props.onConfigSaved(true, 'A');
    });

    expect(supabaseSyncMock.saveHeatConfig).toHaveBeenCalledWith('test-authoritative-open-r1-h1', expect.anything());

    // Verify realtime channels use the authoritative ID
    expect(realtimeSyncMock.publishConfigUpdate).toHaveBeenCalledWith('test-authoritative-open-r1-h1', expect.anything());
  });
});
