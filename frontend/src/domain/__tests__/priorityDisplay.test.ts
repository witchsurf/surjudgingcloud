import { describe, expect, it } from 'vitest';
import { resolvePriorityDisplaySignal } from '../priorityDisplay';

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  heat_id: 'heat-1',
  status: 'running',
  priority_state: { mode: 'ordered', order: ['ROUGE', 'BLANC'], inFlight: [] },
  surfers: ['ROUGE', 'BLANC'],
  ...overrides,
});

describe('priority HDMI signal', () => {
  it('renders the complete business order from left to right', () => {
    expect(resolvePriorityDisplaySignal(snapshot(), true)).toEqual({
      colors: ['ROUGE', 'BLANC'],
      cssColors: ['#ff0000', '#ffffff'],
      reason: 'active_priority',
    });
  });

  it('supports a six-surfer priority order without recalculating it', () => {
    expect(resolvePriorityDisplaySignal(snapshot({
      priority_state: { mode: 'ordered', order: ['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK'], inFlight: [] },
      surfers: ['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK'],
    }), true)).toEqual({
      colors: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'],
      cssColors: ['#ff0000', '#ffffff', '#ffff00', '#0000ff', '#00ff00', '#000000'],
      reason: 'active_priority',
    });
  });

  it.each([
    [null, true, 'no_active_heat'],
    [snapshot(), false, 'signal_lost'],
    [snapshot({ status: 'waiting' }), true, 'heat_inactive'],
    [snapshot({ status: 'closed' }), true, 'heat_inactive'],
    [snapshot({ priority_state: { mode: 'equal', order: [], inFlight: [] } }), true, 'priority_not_established'],
    [snapshot({ priority_state: { mode: 'opening', order: ['ROUGE'], inFlight: [] } }), true, 'priority_not_established'],
    [snapshot({ priority_state: { mode: 'ordered', order: ['ROUGE'], inFlight: ['ROUGE'] } }), true, 'invalid_priority'],
    [snapshot({ priority_state: { mode: 'ordered', order: ['MAGENTA'], inFlight: [] } }), true, 'invalid_priority'],
  ])('fails closed to black (%s)', (input, fresh, reason) => {
    expect(resolvePriorityDisplaySignal(input as ReturnType<typeof snapshot> | null, fresh)).toEqual({
      colors: [],
      cssColors: [],
      reason,
    });
  });

  it('keeps the complete priority order visible while the heat is paused', () => {
    expect(resolvePriorityDisplaySignal(snapshot({ status: 'paused' }), true).colors).toEqual(['ROUGE', 'BLANC']);
  });

  it('removes an in-flight surfer from the panel until the priority judge returns it', () => {
    expect(resolvePriorityDisplaySignal(snapshot({
      priority_state: { mode: 'ordered', order: ['BLANC'], inFlight: ['ROUGE'] },
    }), true).colors).toEqual(['BLANC']);
  });

  it('shows the surfer at the last rank after the priority judge returns it', () => {
    expect(resolvePriorityDisplaySignal(snapshot({
      priority_state: { mode: 'ordered', order: ['BLANC', 'ROUGE'], inFlight: [] },
    }), true).colors).toEqual(['BLANC', 'ROUGE']);
  });

  it('allows an empty panel while every surfer is explicitly in flight', () => {
    expect(resolvePriorityDisplaySignal(snapshot({
      priority_state: { mode: 'ordered', order: [], inFlight: ['ROUGE', 'BLANC'] },
    }), true)).toEqual({
      colors: [],
      cssColors: [],
      reason: 'active_priority',
    });
  });

  it('fails closed instead of showing an incomplete ordered lineup', () => {
    expect(resolvePriorityDisplaySignal(snapshot({
      priority_state: { mode: 'ordered', order: ['ROUGE'], inFlight: [] },
    }), true)).toEqual({
      colors: [],
      cssColors: [],
      reason: 'invalid_priority',
    });
  });
});
