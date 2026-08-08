import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Score } from '../../types';
import HeatResults from '../HeatResults';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: () => false, supabase: null }));
vi.mock('../../hooks/useHeatParticipantDetails', () => ({
  useHeatParticipantDetails: () => ({
    entryMap: new Map([['ROUGE', { jersey: 'ROUGE', name: 'Athlète rouge', country: 'SN' }]]),
    loading: false,
    error: null,
  }),
}));
vi.mock('../../lib/sharedHeatTableSubscriptions', () => ({
  subscribeToHeatInterference: () => () => undefined,
  subscribeToHeatScores: () => () => undefined,
}));

const scores: Score[] = [6, 7, 8].map((value, index) => ({
  id: `score-${index + 1}`,
  heat_id: 'heat-ui-p2', competition: 'Test', division: 'OPEN', round: 1,
  judge_id: `J${index + 1}`, judge_name: `Juge ${index + 1}`, judge_station: `J${index + 1}`,
  surfer: 'ROUGE', wave_number: 1, score: value,
  timestamp: `2026-03-23T10:0${index}:00.000Z`, created_at: `2026-03-23T10:0${index}:00.000Z`,
}));

describe('HeatResults P2 consumer', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderPanel = (judgeIds: string[]) => act(() => root.render(
    <HeatResults
      heatId="heat-ui-p2" competition="Test" division="OPEN" round={1} heatNumber={1}
      surfers={['ROUGE']} judgeIds={judgeIds} judgeNames={{}} maxWaves={4}
      scores={scores} visible status="running"
    />,
  ));

  it('renders the canonical P2 total proven equal to legacy', () => {
    renderPanel(['J1', 'J2', 'J3']);
    expect(container.textContent).toContain('Athlète rouge');
    expect(container.textContent).toContain('7.00');
    expect(container.textContent).not.toContain('Divergence scoring P2');
  });

  it('shows an explicit operator state for an unsupported panel', () => {
    renderPanel(['J1', 'J2', 'J3', 'J4']);
    expect(container.textContent).toContain('Panel 4 juges non supporté');
    expect(container.textContent).not.toContain('7.00');
  });
});
