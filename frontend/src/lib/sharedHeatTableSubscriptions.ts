import type { RealtimeChannel } from '@supabase/supabase-js';
import { ensureHeatId } from '../utils/heat';
import { isLocalSupabaseMode, supabase } from './supabase';

type HeatSignalType = 'scores' | 'interference' | 'participants';
type Listener = () => void;

type HeatSignalState = {
  channel: RealtimeChannel | null;
  pollingInterval: ReturnType<typeof setInterval> | null;
  listeners: Record<HeatSignalType, Map<string, Listener>>;
};

const HEAT_SIGNAL_POLL_INTERVAL_MS = 2500;

const heatSignalRegistry = new Map<string, HeatSignalState>();
let listenerSequence = 0;

const createState = (): HeatSignalState => ({
  channel: null,
  pollingInterval: null,
  listeners: {
    scores: new Map(),
    interference: new Map(),
    participants: new Map(),
  },
});

const emit = (state: HeatSignalState, type: HeatSignalType) => {
  for (const listener of state.listeners[type].values()) {
    try {
      listener();
    } catch (error) {
      console.error('❌ Shared heat signal listener failed:', error);
    }
  }
};

const hasListeners = (state: HeatSignalState) =>
  Object.values(state.listeners).some((listeners) => listeners.size > 0);

const release = (heatId: string) => {
  const state = heatSignalRegistry.get(heatId);
  if (!state || hasListeners(state)) return;

  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
  }

  if (state.channel && supabase) {
    try {
      state.channel.unsubscribe();
      supabase.removeChannel(state.channel);
    } catch (error) {
      console.warn('⚠️ Failed to release shared heat signal channel', heatId, error);
    }
  }

  heatSignalRegistry.delete(heatId);
};

const ensureState = (heatId: string) => {
  const existing = heatSignalRegistry.get(heatId);
  if (existing) return existing;

  const state = createState();

  if (isLocalSupabaseMode()) {
    state.pollingInterval = setInterval(() => {
      emit(state, 'scores');
      emit(state, 'interference');
      emit(state, 'participants');
    }, HEAT_SIGNAL_POLL_INTERVAL_MS);
  } else if (supabase) {
    state.channel = supabase
      .channel(`shared-heat-signals-${heatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores', filter: `heat_id=eq.${heatId}` },
        () => emit(state, 'scores')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'interference_calls', filter: `heat_id=eq.${heatId}` },
        () => emit(state, 'interference')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'heat_entries', filter: `heat_id=eq.${heatId}` },
        () => emit(state, 'participants')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'heat_slot_mappings', filter: `heat_id=eq.${heatId}` },
        () => emit(state, 'participants')
      )
      .subscribe();
  }

  heatSignalRegistry.set(heatId, state);
  return state;
};

const subscribe = (heatId: string, type: HeatSignalType, listener: Listener) => {
  const normalizedHeatId = ensureHeatId(heatId);
  const state = ensureState(normalizedHeatId);
  const listenerId = `heat-signal-${listenerSequence += 1}`;

  state.listeners[type].set(listenerId, listener);

  return () => {
    state.listeners[type].delete(listenerId);
    release(normalizedHeatId);
  };
};

export const subscribeToHeatScores = (heatId: string, listener: Listener) =>
  subscribe(heatId, 'scores', listener);

export const subscribeToHeatInterference = (heatId: string, listener: Listener) =>
  subscribe(heatId, 'interference', listener);

export const subscribeToHeatParticipants = (heatId: string, listener: Listener) =>
  subscribe(heatId, 'participants', listener);
