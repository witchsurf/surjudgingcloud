import type { RealtimeChannel } from '@supabase/supabase-js';
import { ensureHeatId } from '../utils/heat';
import { isLocalSupabaseMode, supabase } from './supabase';

type HeatSignalType = 'scores' | 'interference' | 'participants';
type Listener = () => void;

type HeatSignalState = {
  channel: RealtimeChannel | null;
  pollingInterval: ReturnType<typeof setInterval> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  emitTimers: Partial<Record<HeatSignalType, ReturnType<typeof setTimeout>>>;
  reconnecting: boolean;
  retryCount: number;
  listeners: Record<HeatSignalType, Map<string, Listener>>;
};

const HEAT_SIGNAL_POLL_INTERVAL_MS = 2500;
const HEAT_SIGNAL_EMIT_DEBOUNCE_MS = 150;
const HEAT_SIGNAL_RETRY_BASE_MS = 3000;
const HEAT_SIGNAL_RETRY_MAX_MS = 30000;
const HEAT_SIGNAL_POLL_ONLY_THRESHOLD = 4;
const debugRealtimeEnabled = import.meta.env.VITE_DEBUG_REALTIME === 'true';

const heatSignalRegistry = new Map<string, HeatSignalState>();
let listenerSequence = 0;

const updateHeatSignalDebug = () => {
  if (!debugRealtimeEnabled || typeof window === 'undefined') return;

  const root = ((window as typeof window & { __surfRealtimeDebug?: Record<string, unknown> }).__surfRealtimeDebug ??= {});
  root.heatSignals = {
    heats: Array.from(heatSignalRegistry.entries()).map(([heatId, state]) => ({
      heatId,
      hasChannel: Boolean(state.channel),
      hasPolling: Boolean(state.pollingInterval),
      reconnecting: state.reconnecting,
      retryCount: state.retryCount,
      listeners: {
        scores: state.listeners.scores.size,
        interference: state.listeners.interference.size,
        participants: state.listeners.participants.size,
      },
    })),
    updatedAt: new Date().toISOString(),
  };
};

const createState = (): HeatSignalState => ({
  channel: null,
  pollingInterval: null,
  retryTimer: null,
  emitTimers: {},
  reconnecting: false,
  retryCount: 0,
  listeners: {
    scores: new Map(),
    interference: new Map(),
    participants: new Map(),
  },
});

const startPolling = (state: HeatSignalState) => {
  if (state.pollingInterval) return;

  state.pollingInterval = setInterval(() => {
    emit(state, 'scores');
    emit(state, 'interference');
    emit(state, 'participants');
  }, HEAT_SIGNAL_POLL_INTERVAL_MS);
};

const stopPolling = (state: HeatSignalState) => {
  if (!state.pollingInterval) return;
  clearInterval(state.pollingInterval);
  state.pollingInterval = null;
};

const emit = (state: HeatSignalState, type: HeatSignalType) => {
  const existingTimer = state.emitTimers[type];
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  state.emitTimers[type] = setTimeout(() => {
    delete state.emitTimers[type];
    updateHeatSignalDebug();

    for (const listener of state.listeners[type].values()) {
      try {
        listener();
      } catch (error) {
        console.error('❌ Shared heat signal listener failed:', error);
      }
    }
  }, HEAT_SIGNAL_EMIT_DEBOUNCE_MS);
};

const hasListeners = (state: HeatSignalState) =>
  Object.values(state.listeners).some((listeners) => listeners.size > 0);

const release = (heatId: string) => {
  const state = heatSignalRegistry.get(heatId);
  if (!state || hasListeners(state)) return;

  if (state.pollingInterval) {
    stopPolling(state);
  }

  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }

  for (const timer of Object.values(state.emitTimers)) {
    if (timer) clearTimeout(timer);
  }
  state.emitTimers = {};

  if (state.channel && supabase) {
    try {
      const channel = state.channel;
      state.channel = null;
      state.reconnecting = false;
      channel.unsubscribe();
      supabase.removeChannel(channel);
    } catch (error) {
      console.warn('⚠️ Failed to release shared heat signal channel', heatId, error);
    }
  }

  heatSignalRegistry.delete(heatId);
  updateHeatSignalDebug();
};

const ensureState = (heatId: string) => {
  const existing = heatSignalRegistry.get(heatId);
  if (existing) return existing;

  const state = createState();
  heatSignalRegistry.set(heatId, state);
  updateHeatSignalDebug();

  if (isLocalSupabaseMode()) {
    startPolling(state);
  } else if (supabase) {
    const channelName = `shared-heat-signals-${heatId}`;

    const setupChannel = () => {
      if (!heatSignalRegistry.has(heatId)) return; // Released

      if (state.channel && supabase) {
        try {
          const previousChannel = state.channel;
          state.channel = null;
          previousChannel.unsubscribe();
          supabase.removeChannel(previousChannel);
        } catch (error) {
          console.warn('⚠️ Failed to recycle shared heat signal channel', heatId, error);
        }
      }

      const channel = supabase!.channel(channelName);
      state.channel = channel;

      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'scores', filter: `heat_id=eq.${heatId}` },
          (payload) => {
            if (typeof window !== 'undefined' && payload.new) {
              window.dispatchEvent(new CustomEvent('newScoreRealtime', {
                detail: payload.new,
              }));
            }
            emit(state, 'scores');
          }
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
        .subscribe((status, err) => {
          updateHeatSignalDebug();
          if (state.channel !== channel) return;

          if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
            if (state.reconnecting) return;
            state.reconnecting = true;
            state.retryCount += 1;
            startPolling(state);
            const retryDelay = Math.min(
              HEAT_SIGNAL_RETRY_MAX_MS,
              HEAT_SIGNAL_RETRY_BASE_MS * 2 ** Math.max(state.retryCount - 1, 0)
            );
            const fallbackOnly = state.retryCount >= HEAT_SIGNAL_POLL_ONLY_THRESHOLD;
            console.warn(
              `⚠️ Shared stream ${channelName} dropped (${status}), ${fallbackOnly ? 'falling back to polling before next retry' : 'scheduling reconnect'}...`,
              err
            );
            state.channel = null;
            supabase!.removeChannel(channel).catch(() => {});
            if (state.retryTimer) clearTimeout(state.retryTimer);
            state.retryTimer = setTimeout(() => {
              state.retryTimer = null;
              if (heatSignalRegistry.has(heatId)) {
                console.log(`🔄 Reconnecting shared heat stream ${channelName}...`);
                setupChannel();
              }
            }, fallbackOnly ? retryDelay : retryDelay + Math.random() * 2000);
          } else if (status === 'SUBSCRIBED') {
            state.reconnecting = false;
            state.retryCount = 0;
            stopPolling(state);
            // Heal any missed events upon reconnect by emitting events
            emit(state, 'scores');
            emit(state, 'interference');
            emit(state, 'participants');
          }
        });
    };

    setupChannel();
  }

  return state;
};

const subscribe = (heatId: string, type: HeatSignalType, listener: Listener) => {
  const normalizedHeatId = ensureHeatId(heatId);
  const state = ensureState(normalizedHeatId);
  const listenerId = `heat-signal-${listenerSequence += 1}`;

  state.listeners[type].set(listenerId, listener);
  updateHeatSignalDebug();

  return () => {
    state.listeners[type].delete(listenerId);
    updateHeatSignalDebug();
    release(normalizedHeatId);
  };
};

export const subscribeToHeatScores = (heatId: string, listener: Listener) =>
  subscribe(heatId, 'scores', listener);

export const subscribeToHeatInterference = (heatId: string, listener: Listener) =>
  subscribe(heatId, 'interference', listener);

export const subscribeToHeatParticipants = (heatId: string, listener: Listener) =>
  subscribe(heatId, 'participants', listener);
