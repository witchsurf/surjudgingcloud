import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const adminInterfaceMock = vi.hoisted(() => ({ props: null as any }));

const configStoreMock = vi.hoisted(() => ({
  config: {
    competition: 'P38-Test2-Disposable',
    division: 'OPEN',
    round: 1,
    heatId: 1,
    judges: ['J1', 'J2', 'J3'],
    judgeNames: { J1: 'Judge 1', J2: 'Judge 2', J3: 'Judge 3' },
    judgeIdentities: {},
    surfers: ['ROUGE', 'BLANC', 'JAUNE'],
    surferNames: {},
    surferCountries: {},
    waves: 15,
    tournamentType: 'elimination',
    surfersPerHeat: 3,
    totalSurfers: 3,
    totalHeats: 1,
    totalRounds: 1,
  } as AppConfig,
  setConfig: vi.fn(),
  configSaved: true,
  setConfigSaved: vi.fn(),
  persistConfig: vi.fn(),
  activeEventId: 10004,
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

const timerHookMock = vi.hoisted(() => ({
  timer: { isRunning: false, startTime: null, duration: 20 },
  setTimer: vi.fn(),
  setDuration: vi.fn(),
}));

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
  createHeat: vi.fn(async () => ({ id: 'p38-test2-disposable_open_r1_h1' })),
  saveHeatConfig: vi.fn(async () => undefined),
}));

let resolveSchedulePromise: ((value: any) => void) | null = null;

const heatsApiMock = vi.hoisted(() => ({
  fetchOrderedHeatSequence: vi.fn(async () => []),
  fetchHeatBySchedule: vi.fn(() => new Promise((resolve) => {
    resolveSchedulePromise = resolve;
  })),
  fetchHeatMetadata: vi.fn(async () => ({
    id: 'p38-test2-disposable_open_r1_h1',
    event_id: 10004,
    competition: 'P38-Test2-Disposable',
    division: 'OPEN',
    round: 1,
    heat_number: 1,
    heat_size: 3,
    status: 'open',
    color_order: ['RED', 'WHITE', 'YELLOW'],
    created_at: '2026-08-10T21:00:46.034689Z',
  })),
  validateHeatStartDependencies: vi.fn(async () => ({
    ok: true,
    heat_id: 'p38-test2-disposable_open_r1_h1',
    blockers: [],
  })),
}));

const heatParticipantsMock = vi.hoisted(() => ({ useHeatParticipants: vi.fn(() => ({ participants: {} })) }));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('eventId=10004'), vi.fn()],
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
  resolveEventIdForHeat: vi.fn(async () => 10004),
}));

vi.mock('../../api/modules/events.api', () => ({
  updateEventConfiguration: vi.fn(async () => undefined),
  saveEventConfigSnapshot: vi.fn(async () => undefined),
}));

vi.mock('../../api/modules/heats.api', () => heatsApiMock);

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  canUseSupabaseConnection: () => true,
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
  },
}));

vi.mock('../../utils/secureStorage', () => ({
  getSafeLocalStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import AdminPage from '../AdminPage';

describe('AdminPage strict canonical heat ID without synthetic fallback', () => {
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

  it('maintains 0 subscriptions/operations while pending, then uses strictly authoritative ID', async () => {
    await act(async () => {
      root.render(<AdminPage />);
    });

    // 1. While async schedule resolution is pending:
    // canonicalHeatId is empty string / not resolved
    expect(adminInterfaceMock.props.canonicalHeatId).toBe('');
    expect(adminInterfaceMock.props.loadState).toBe('loading');

    // Assert: zero timer subscriptions while pending
    expect(realtimeSyncMock.subscribeToHeat).toHaveBeenCalledTimes(0);

    // Assert: heat participants not called with any synthetic ID
    expect(heatParticipantsMock.useHeatParticipants).toHaveBeenCalledWith('');

    // 2. Now resolve the authoritative heat from DB:
    await act(async () => {
      resolveSchedulePromise?.({ id: 'p38-test2-disposable_open_r1_h1' });
    });

    // Wait for the state update
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adminInterfaceMock.props.canonicalHeatId).toBe('p38-test2-disposable_open_r1_h1');
    expect(adminInterfaceMock.props.loadState).toBe('loaded');

    // Subscribe is now called with the authoritative DB ID
    expect(realtimeSyncMock.subscribeToHeat).toHaveBeenCalledWith(
      'p38-test2-disposable_open_r1_h1',
      expect.any(Function)
    );

    // Trigger save
    await act(async () => {
      await adminInterfaceMock.props.onConfigSaved(true, 'A');
    });

    // Assert DB and Realtime writes use authoritative ID and NEVER the synthetic ID
    expect(supabaseSyncMock.saveHeatConfig).toHaveBeenCalledWith(
      'p38-test2-disposable_open_r1_h1',
      expect.anything()
    );
    expect(realtimeSyncMock.publishConfigUpdate).toHaveBeenCalledWith(
      'p38-test2-disposable_open_r1_h1',
      expect.anything()
    );

    // Verify 0 occurrences of the event-name-derived synthetic ID
    const allCallsString = JSON.stringify([
      realtimeSyncMock.subscribeToHeat.mock.calls,
      supabaseSyncMock.saveHeatConfig.mock.calls,
      realtimeSyncMock.publishConfigUpdate.mock.calls,
    ]);
    expect(allCallsString).not.toContain('p38_test2_disposable_open_r1_h1');
  });
});
