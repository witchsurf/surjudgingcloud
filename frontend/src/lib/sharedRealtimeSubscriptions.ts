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
  event_name?: string;
  active_heat_id?: string;
};

const EVENT_CONFIG_POLL_INTERVAL_MS = 3000;
const ACTIVE_HEAT_POINTER_POLL_INTERVAL_MS = 3000;

const eventConfigRegistry = new Map<number, RegistryState<EventConfigRealtimeRow>>();
const activeHeatPointerRegistry = new Map<string, RegistryState<ActiveHeatPointerRealtimeRow>>();
let listenerSequence = 0;

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
  };
};

const emitToListeners = <T>(state: RegistryState<T>, payload: T) => {
  if (state.lastPayload && JSON.stringify(state.lastPayload) === JSON.stringify(payload)) {
    return;
  }

  state.lastPayload = payload;
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
  state.pollingInterval = setInterval(() => {
    void refresh();
  }, EVENT_CONFIG_POLL_INTERVAL_MS);

  if (!isLocalSupabaseMode() && supabase) {
    void refresh();
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
      .subscribe();
  }

  return addListener(eventConfigRegistry as Map<string | number, RegistryState<EventConfigRealtimeRow>>, eventId, state, listener);
};

export const subscribeToActiveHeatPointer = (
  eventName: string | undefined,
  listener: Listener<ActiveHeatPointerRealtimeRow>
) => {
  const normalizedEventName = (eventName || '').trim();
  const key = normalizeEventRealtimeKey(normalizedEventName) || 'global';
  const realtimeFilter = canUseRealtimeEqualityFilter(normalizedEventName)
    ? `event_name=eq.${normalizedEventName}`
    : undefined;
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
    return normalizeEventRealtimeKey(row.event_name) === key;
  };

  const refresh = async () => {
    try {
      const row = await fetchActiveHeatPointer(normalizedEventName || undefined);
      if (!matchesEvent(row)) return;
      emitToListeners(state, row);
    } catch (error) {
      console.warn('⚠️ Shared active_heat_pointer refresh failed:', error);
    }
  };

  void refresh();
  state.pollingInterval = setInterval(() => {
    void refresh();
  }, ACTIVE_HEAT_POINTER_POLL_INTERVAL_MS);

  if (!isLocalSupabaseMode() && supabase) {
    void refresh();
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
      .subscribe();
  }

  return addListener(activeHeatPointerRegistry as Map<string | number, RegistryState<ActiveHeatPointerRealtimeRow>>, key, state, listener);
};
