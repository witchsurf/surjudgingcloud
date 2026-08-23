import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const configStoreMock = vi.hoisted(() => ({
  config: {
    competition: 'Mamelles', division: 'OPEN', round: 1, heatId: 1,
    judges: ['J1', 'J2', 'J3'], judgeNames: {}, judgeIdentities: {},
    surfers: ['ROUGE', 'BLANC'], surferNames: {}, surferCountries: {},
    waves: 15, tournamentType: 'elimination',
    surfersPerHeat: 2, totalSurfers: 2, totalHeats: 2, totalRounds: 1,
  },
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
  heatStatus: 'closed',
  timer: { isRunning: false, startTime: null, duration: 20 },
  setTimer: vi.fn(),
  setHeatStatus: vi.fn(),
  setScores: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(''), vi.fn()] }));
vi.mock('../../components/AdminInterface', () => ({ default: () => null }));
vi.mock('../../stores/configStore', () => ({ useConfigStore: () => configStoreMock }));
vi.mock('../../stores/judgingStore', () => ({ useJudgingStore: () => judgingStoreMock }));
vi.mock('../../hooks/useCompetitionTimer', () => ({
  useCompetitionTimer: () => ({ timer: judgingStoreMock.timer, setTimer: vi.fn(), setDuration: vi.fn() }),
}));
vi.mock('../../hooks/useHeatManager', () => ({ useHeatManager: () => ({ closeHeat: vi.fn(async () => undefined) }) }));
vi.mock('../../hooks/useRealtimeSync', () => ({
  useRealtimeSync: () => ({
    publishConfigUpdate: vi.fn(async () => undefined),
    publishTimerStart: vi.fn(async () => undefined),
    publishTimerPause: vi.fn(async () => undefined),
    publishTimerReset: vi.fn(async () => undefined),
    subscribeToHeat: vi.fn(() => () => undefined),
  }),
}));
vi.mock('../../hooks/useScoreManager', () => ({ useScoreManager: () => ({ handleScoreOverride: vi.fn(async () => undefined) }) }));
vi.mock('../../hooks/useSupabaseSync', () => ({
  useSupabaseSync: () => ({ createHeat: vi.fn(async () => ({})), saveHeatConfig: vi.fn(async () => undefined) }),
}));
vi.mock('../../hooks/useHeatParticipants', () => ({ useHeatParticipants: () => ({ participants: {} }) }));
vi.mock('../../utils/heatWorkflow', () => ({ resolveEventIdForHeat: vi.fn(async () => 10) }));
vi.mock('../../api/modules/events.api', () => ({
  updateEventConfiguration: vi.fn(async () => undefined),
  saveEventConfigSnapshot: vi.fn(async () => undefined),
}));
vi.mock('../../api/modules/heats.api', () => ({
  fetchOrderedHeatSequence: vi.fn(async () => []),
  fetchHeatBySchedule: vi.fn(async () => ({ id: 'heat_1' })),
  fetchHeatMetadata: vi.fn(async () => ({ id: 'heat_1' })),
}));
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: () => true, canUseSupabaseConnection: () => true }));
vi.mock('../../utils/secureStorage', () => ({
  getSafeLocalStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import AdminPage from '../AdminPage';

describe('BUG 1 — le statut live stale (closed) ne doit pas verrouiller le heat nouvellement sélectionné', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    configStoreMock.config = { ...configStoreMock.config, heatId: 1, round: 1 };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('sélectionner un nouveau heat (H1 → H2) réinitialise le live heatStatus (plus de closed parasite)', async () => {
    await act(async () => {
      root.render(<AdminPage />);
    });
    judgingStoreMock.setHeatStatus.mockClear();

    // L'opérateur sélectionne un NOUVEAU heat OPEN (H2) après avoir fermé H1.
    configStoreMock.config = { ...configStoreMock.config, heatId: 2 };
    await act(async () => {
      root.render(<AdminPage />);
    });

    expect(judgingStoreMock.setHeatStatus).toHaveBeenCalledWith('waiting');
  });
});