import type { RealtimeChannel } from '@supabase/supabase-js';
import { fetchActiveHeatPointer, fetchEventConfigSnapshot } from '../api/supabaseClient';
import { isLocalSupabaseMode, supabase } from './supabase';

type Listener<T> = (payload: T) => void;

type RegistryState<T> = {
  channel: RealtimeChannel | null;
  listeners: Map<string, Listener<T>>;
  pollingInterval: ReturnType<typeof setInterval> | null;
  lastPayload: T | null;
};

export type EventConfigRealtimeRow = {
  event_id?: number;
  event_name?: string;
  division?: string;
  round?: number;
  heat_number?: number;
};

export type ActiveHeatPointerRealtimeRow = {
  event_id?: number | null;
  event_name?: string;
  active_heat_id?: string;
};

const EVENT_CONFIG_POLL_INTERVAL_MS = 3000;
const ACTIVE_HEAT_POINTER_POLL_INTERVAL_MS = 3000;
const debugRealtimeEnabled = import.meta.env.VITE_DEBUG_REALTIME === 'true';

const eventConfigRegistry = new Map<number, RegistryState<EventConfigRealtimeRow>>();
const activeHeatPointerRegistry = new Map<string, RegistryState<ActiveHeatPointerRealtimeRow>>();
let listenerSequence = 0;

const updateSharedRealtimeDebug = () => {
  if (!debugRealtimeEnabled || typeof window === 'undefined') return;

  const root = ((window as typeof window & { __surfRealtimeDebug?: Record<string, unknown> }).__surfRealtimeDebug ??= {});
  root.sharedRealtime = {
    eventConfigChannels: Array.from(eventConfigRegistry.entries()).map(([key, state]) => ({
      key,
      listeners: state.listeners.size,
      hasChannel: Boolean(state.channel),
      hasPolling: Boolean(state.pollingInterval),
    })),
    activeHeatChannels: Array.from(activeHeatPointerRegistry.entries()).map(([key, state]) => ({
      key,
      listeners: state.listeners.size,
      hasChannel: Boolean(state.channel),
      hasPolling: Boolean(state.pollingInterval),
    })),
    updatedAt: new Date().toISOString(),
  };
};

export const normalizeEventRealtimeKey = (value?: string) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');

const canUseRealtimeEqualityFilter = (value?: string) =>
  Boolean(value) && /^[A-Za-z0-9 _-]+$/.test(value || '');

const addListener = <T>(
  registry: Map<string | number, RegistryState<T>>,
  key: string | number,
  state: RegistryState<T>,
  listener: Listener<T>
) => {
  const listenerId = `listener_${listenerSequence += 1}`;
  state.listeners.set(listenerId, listener);
  registry.set(key, state);
  updateSharedRealtimeDebug();

  if (state.lastPayload) {
    listener(state.lastPayload);
  }

  return () => {
    state.listeners.delete(listenerId);
    if (state.listeners.size > 0) {
      return;
    }

    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
    }

    if (state.channel && supabase) {
      try {
        state.channel.unsubscribe();
        supabase.removeChannel(state.channel);
      } catch (error) {
        console.warn('⚠️ Failed to release shared realtime channel', key, error);
      }
    }

    registry.delete(key);
    updateSharedRealtimeDebug();
  };
};

const emitToListeners = <T>(state: RegistryState<T>, payload: T) => {
  if (state.lastPayload && JSON.stringify(state.lastPayload) === JSON.stringify(payload)) {
    return;
  }

  state.lastPayload = payload;
  updateSharedRealtimeDebug();
  for (const listener of state.listeners.values()) {
    try {
      listener(payload);
    } catch (error) {
      console.error('❌ Shared realtime listener failed:', error);
    }
  }
};

export const subscribeToEventConfig = (
  eventId: number,
  listener: Listener<EventConfigRealtimeRow>
) => {
  const existing = eventConfigRegistry.get(eventId);
  if (existing) {
    return addListener(eventConfigRegistry as Map<string | number, RegistryState<EventConfigRealtimeRow>>, eventId, existing, listener);
  }

  const state: RegistryState<EventConfigRealtimeRow> = {
    channel: null,
    listeners: new Map(),
    pollingInterval: null,
    lastPayload: null,
  };

  const refresh = async () => {
    try {
      const snapshot = await fetchEventConfigSnapshot(eventId);
      if (!snapshot) return;
      emitToListeners(state, {
        event_id: snapshot.event_id,
        event_name: snapshot.event_name,
        division: snapshot.division,
        round: snapshot.round,
        heat_number: snapshot.heat_number,
      });
    } catch (error) {
      console.warn('⚠️ Shared event_last_config refresh failed:', error);
    }
  };

  void refresh();
  if (isLocalSupabaseMode()) {
    state.pollingInterval = setInterval(() => {
      void refresh();
    }, EVENT_CONFIG_POLL_INTERVAL_MS);
  }

  if (!isLocalSupabaseMode() && supabase) {
    state.channel = supabase
      .channel(`shared-event-config-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_last_config',
          filter: `event_id=eq.${eventId}`
        },
        (payload) => {
          const row = payload.new as EventConfigRealtimeRow | null;
          if (!row) return;
          emitToListeners(state, row);
        }
      )
      .subscribe((status) => {
        updateSharedRealtimeDebug();
        if (status === 'SUBSCRIBED') {
          void refresh();
        }
      });
  }

  return addListener(eventConfigRegistry as Map<string | number, RegistryState<EventConfigRealtimeRow>>, eventId, state, listener);
};

export const subscribeToActiveHeatPointer = (
  eventId: number | null | undefined,
  eventName: string | undefined,
  listener: Listener<ActiveHeatPointerRealtimeRow>
) => {
  const normalizedEventName = (eventName || '').trim();
  const eventIdKey = Number.isFinite(Number(eventId)) && Number(eventId) > 0 ? Number(eventId) : null;
  const key = eventIdKey ?? (normalizeEventRealtimeKey(normalizedEventName) || 'global');
  const realtimeFilter = eventIdKey
    ? `event_id=eq.${eventIdKey}`
    : (canUseRealtimeEqualityFilter(normalizedEventName)
      ? `event_name=eq.${normalizedEventName}`
      : undefined);
  const existing = activeHeatPointerRegistry.get(key);
  if (existing) {
    return addListener(activeHeatPointerRegistry as Map<string | number, RegistryState<ActiveHeatPointerRealtimeRow>>, key, existing, listener);
  }

  const state: RegistryState<ActiveHeatPointerRealtimeRow> = {
    channel: null,
    listeners: new Map(),
    pollingInterval: null,
    lastPayload: null,
  };

  const matchesEvent = (row: ActiveHeatPointerRealtimeRow | null) => {
    if (!row?.active_heat_id) return false;
    if (!key || key === 'global') return true;
    if (eventIdKey) return Number(row.event_id) === eventIdKey;
    return normalizeEventRealtimeKey(row.event_name) === key;
  };

  const refresh = async () => {
    try {
      const row = await fetchActiveHeatPointer(eventIdKey, normalizedEventName || undefined);
      if (!matchesEvent(row)) return;
      emitToListeners(state, row);
    } catch (error) {
      console.warn('⚠️ Shared active_heat_pointer refresh failed:', error);
    }
  };

  void refresh();
  if (isLocalSupabaseMode()) {
    state.pollingInterval = setInterval(() => {
      void refresh();
    }, ACTIVE_HEAT_POINTER_POLL_INTERVAL_MS);
  }

  if (!isLocalSupabaseMode() && supabase) {
    state.channel = supabase
      .channel(`shared-active-heat-${key}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'active_heat_pointer',
          ...(realtimeFilter ? { filter: realtimeFilter } : {})
        },
        (payload) => {
          const row = payload.new as ActiveHeatPointerRealtimeRow | null;
          if (!matchesEvent(row)) return;
          emitToListeners(state, row);
        }
      )
      .subscribe((status) => {
        updateSharedRealtimeDebug();
        if (status === 'SUBSCRIBED') {
          void refresh();
        }
      });
  }

  return addListener(activeHeatPointerRegistry as Map<string | number, RegistryState<ActiveHeatPointerRealtimeRow>>, key, state, listener);
};
