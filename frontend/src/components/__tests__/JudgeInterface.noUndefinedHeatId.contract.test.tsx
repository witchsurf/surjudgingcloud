import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JudgeInterface from '../JudgeInterface';
import type { AppConfig } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: () => true,
  isLocalSupabaseMode: () => false,
}));

vi.mock('../../api/modules/heats.api', () => ({
  fetchHeatMetadata: vi.fn().mockResolvedValue({
    id: 'p38-test2-disposable_open_r1_h1',
    event_id: 10004,
  }),
}));

describe('JudgeInterface — No undefined heatId reference & Authoritative ID Contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockConfig: AppConfig = {
    competition: 'P38-Test2-Disposable',
    division: 'OPEN',
    round: 1,
    heatId: 1,
    waves: 10,
    surfers: ['ROUGE', 'BLANC'],
    judges: ['J1', 'J2'],
    judgeNames: { J1: 'Judge 1', J2: 'Judge 2' },
    surferNames: { ROUGE: 'Surfer Red', BLANC: 'Surfer White' },
    surferCountries: {},
    tournamentType: 'elimination',
    totalSurfers: 2,
    surfersPerHeat: 2,
    totalHeats: 1,
    totalRounds: 1,
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders without throwing ReferenceError: heatId is not defined', async () => {
    const renderFn = () => {
      act(() => {
        root.render(
          <JudgeInterface
            config={mockConfig}
            heatId="p38-test2-disposable_open_r1_h1"
            judgeId="J1"
            judgeName="Judge 1"
          />
        );
      });
    };

    expect(renderFn).not.toThrow();
  });

  it('renders cleanly even when heatId prop is omitted (falls back safely to identifiers)', async () => {
    const renderFn = () => {
      act(() => {
        root.render(
          <JudgeInterface
            config={mockConfig}
            judgeId="J1"
            judgeName="Judge 1"
          />
        );
      });
    };

    expect(renderFn).not.toThrow();
  });
});
