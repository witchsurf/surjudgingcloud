import type { RealtimeChannel } from '@supabase/supabase-js';
import { ensureHeatId } from '../utils/heat';
import { isLocalSupabaseMode, supabase } from './supabase';

type HeatSignalType = 'scores' | 'interference' | 'participants';
type Listener = () => void;
type SubscriptionMode = 'auto' | 'realtime' | 'polling';

type ListenerEntry = {
  listener: Listener;
  mode: SubscriptionMode;
};

type HeatSignalState = {
  channel: RealtimeChannel | null;
  pollingInterval: ReturnType<typeof setInterval> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  emitTimers: Partial<Record<HeatSignalType, ReturnType<typeof setTimeout>>>;
  realtimeTypes: Set<HeatSignalType>;
  reconnecting: boolean;
  retryCount: number;
  listeners: Record<HeatSignalType, Map<string, ListenerEntry>>;
};

const HEAT_SIGNAL_POLL_INTERVAL_MS = 2500;
const HEAT_SIGNAL_EMIT_DEBOUNCE_MS = 150;
const HEAT_SIGNAL_RETRY_BASE_MS = 3000;
const HEAT_SIGNAL_RETRY_MAX_MS = 30000;
const HEAT_SIGNAL_POLL_ONLY_THRESHOLD = 4;
const debugRealtimeEnabled = import.meta.env.VITE_DEBUG_REALTIME === 'true';
const heatSignalMode = String(import.meta.env.VITE_HEAT_SIGNAL_MODE || '').trim().toLowerCase();
const forcePolling = heatSignalMode === 'polling' || heatSignalMode === 'poll';
const envDefaultModes = {
  scores: String(import.meta.env.VITE_HEAT_SIGNAL_SCORES_MODE || '').trim().toLowerCase() as SubscriptionMode | '',
  interference: String(import.meta.env.VITE_HEAT_SIGNAL_INTERFERENCE_MODE || '').trim().toLowerCase() as SubscriptionMode | '',
  participants: String(import.meta.env.VITE_HEAT_SIGNAL_PARTICIPANTS_MODE || '').trim().toLowerCase() as SubscriptionMode | '',
} as const;

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
  realtimeTypes: new Set(),
  reconnecting: false,
  retryCount: 0,
  listeners: {
    scores: new Map(),
    interference: new Map(),
    participants: new Map(),
  },
});

const resolveMode = (type: HeatSignalType, mode: SubscriptionMode) => {
  if (mode !== 'auto') return mode;

  const envMode = envDefaultModes[type];
  if (envMode === 'realtime' || envMode === 'polling') return envMode;

  return isLocalSupabaseMode() ? 'polling' : 'realtime';
};

const getDesiredRealtimeTypes = (state: HeatSignalState): Set<HeatSignalType> => {
  if (forcePolling || isLocalSupabaseMode() || !supabase) return new Set();

  const desired = new Set<HeatSignalType>();
  (Object.keys(state.listeners) as HeatSignalType[]).forEach((type) => {
    for (const entry of state.listeners[type].values()) {
      if (resolveMode(type, entry.mode) === 'realtime') {
        desired.add(type);
        break;
      }
    }
  });
  return desired;
};

const getDesiredPollingTypes = (state: HeatSignalState): Set<HeatSignalType> => {
  const desired = new Set<HeatSignalType>();
  (Object.keys(state.listeners) as HeatSignalType[]).forEach((type) => {
    for (const entry of state.listeners[type].values()) {
      if (resolveMode(type, entry.mode) === 'polling') {
        desired.add(type);
        break;
      }
    }
  });
  // Local mode always polls, regardless of listener modes, because websocket delivery is less predictable.
  if (isLocalSupabaseMode()) {
    (Object.keys(state.listeners) as HeatSignalType[]).forEach((type) => {
      if (state.listeners[type].size > 0) desired.add(type);
    });
  }
  return desired;
};

const startPolling = (state: HeatSignalState) => {
  if (state.pollingInterval) return;

  const intervalMs = isLocalSupabaseMode() ? HEAT_SIGNAL_POLL_INTERVAL_MS : 10000;
  state.pollingInterval = setInterval(() => {
    const desired = getDesiredPollingTypes(state);
    desired.forEach((type) => emit(state, type));
  }, intervalMs);
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

    for (const { listener } of state.listeners[type].values()) {
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

  // Note: we intentionally defer setup until the first subscribe call,
  // because realtime vs polling depends on listener modes.

  return state;
};

const reconcile = (heatId: string, state: HeatSignalState) => {
  const desiredRealtimeTypes = getDesiredRealtimeTypes(state);
  const desiredPollingTypes = getDesiredPollingTypes(state);

  // Polling is enabled when local mode forces it, when realtime is degraded,
  // or when at least one consumer explicitly requests polling.
  if (desiredPollingTypes.size > 0 || state.reconnecting) {
    startPolling(state);
  } else {
    stopPolling(state);
  }

  // No realtime types requested → ensure channel is released.
  if (desiredRealtimeTypes.size === 0) {
    if (state.channel && supabase) {
      try {
        const channel = state.channel;
        state.channel = null;
        state.realtimeTypes = new Set();
        channel.unsubscribe();
        supabase.removeChannel(channel);
      } catch (error) {
        console.warn('⚠️ Failed to release shared heat signal channel', heatId, error);
      }
    }
    updateHeatSignalDebug();
    return;
  }

  // Rebuild the channel if the realtime type-set changed.
  const sameTypes = desiredRealtimeTypes.size === state.realtimeTypes.size
    && Array.from(desiredRealtimeTypes).every((t) => state.realtimeTypes.has(t));
  if (sameTypes && state.channel) return;

  const channelName = `shared-heat-signals-${heatId}`;

  const setupChannel = () => {
    if (!heatSignalRegistry.has(heatId)) return; // Released
    if (!supabase) return;

    if (state.channel) {
      try {
        const previousChannel = state.channel;
        state.channel = null;
        previousChannel.unsubscribe();
        supabase.removeChannel(previousChannel);
      } catch (error) {
        console.warn('⚠️ Failed to recycle shared heat signal channel', heatId, error);
      }
    }

    const channel = supabase.channel(channelName);
    state.channel = channel;
    state.realtimeTypes = new Set(desiredRealtimeTypes);

    if (desiredRealtimeTypes.has('scores')) {
      channel.on(
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
      );
    }

    if (desiredRealtimeTypes.has('interference')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'interference_calls', filter: `heat_id=eq.${heatId}` },
        () => emit(state, 'interference')
      );
    }

    if (desiredRealtimeTypes.has('participants')) {
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'heat_entries', filter: `heat_id=eq.${heatId}` },
          () => emit(state, 'participants')
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'heat_slot_mappings', filter: `heat_id=eq.${heatId}` },
          () => emit(state, 'participants')
        );
    }

    channel.subscribe((status, err) => {
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
	        const removal = supabase?.removeChannel(channel);
	        removal?.catch(() => {});
	        if (state.retryTimer) clearTimeout(state.retryTimer);
	        state.retryTimer = setTimeout(() => {
	          state.retryTimer = null;
	          state.reconnecting = false;
          if (heatSignalRegistry.has(heatId)) {
            console.log(`🔄 Reconnecting shared heat stream ${channelName}...`);
            setupChannel();
          }
        }, fallbackOnly ? retryDelay : retryDelay + Math.random() * 2000);
      } else if (status === 'SUBSCRIBED') {
        state.reconnecting = false;
        state.retryCount = 0;
        // Stop polling only if nothing explicitly requires polling.
        if (getDesiredPollingTypes(state).size === 0) {
          stopPolling(state);
        }
        // Heal any missed events upon reconnect by emitting events
        desiredRealtimeTypes.forEach((type) => emit(state, type));
      }
    });
  };

  setupChannel();
};

const subscribe = (
  heatId: string,
  type: HeatSignalType,
  listener: Listener,
  options?: { mode?: SubscriptionMode }
) => {
  const normalizedHeatId = ensureHeatId(heatId);
  const state = ensureState(normalizedHeatId);
  const listenerId = `heat-signal-${listenerSequence += 1}`;

  state.listeners[type].set(listenerId, { listener, mode: options?.mode ?? 'auto' });
  updateHeatSignalDebug();
  reconcile(normalizedHeatId, state);

  return () => {
    state.listeners[type].delete(listenerId);
    updateHeatSignalDebug();
    reconcile(normalizedHeatId, state);
    release(normalizedHeatId);
  };
};

export const subscribeToHeatScores = (heatId: string, listener: Listener, options?: { mode?: SubscriptionMode }) =>
  subscribe(heatId, 'scores', listener, options);

export const subscribeToHeatInterference = (heatId: string, listener: Listener, options?: { mode?: SubscriptionMode }) =>
  subscribe(heatId, 'interference', listener, options);

export const subscribeToHeatParticipants = (heatId: string, listener: Listener, options?: { mode?: SubscriptionMode }) =>
  subscribe(heatId, 'participants', listener, options);
