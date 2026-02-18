/**
 * Sync Cloud Events to Local Storage AND Local Database
 * 
 * This utility syncs events, participants, and heats from cloud Supabase 
 * to the Local Supabase instance, allowing offline clients (like Kiosk tablets)
 * to access the data via the local network.
 */

import { createClient } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase'; // Local Supabase Client

const CLOUD_EVENTS_KEY = 'surfjudging_cloud_events';
const CLOUD_PARTICIPANTS_KEY = 'surfjudging_cloud_participants';
const LAST_SYNC_KEY = 'surfjudging_last_sync';

interface CloudEvent {
  id: number;
  name: string;
  organizer: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  user_id: string;
  created_at: string;
  event_last_config?: any;
}

interface CloudParticipant {
  id: number;
  event_id: number;
  seed: number;
  name: string;
  category: string;
  country?: string;
  license?: string;
}

export function getCloudClient() {
  const url = import.meta.env.VITE_SUPABASE_URL_CLOUD;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY_CLOUD;

  if (!url || !key) {
    throw new Error('Cloud Supabase credentials not configured');
  }

  return createClient(url, key, {
    auth: {
      storageKey: 'surfjudging-cloud-auth-token',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
}

/**
 * Sync events from cloud to local storage AND local DB
 * @param userEmail - Email of the user (used to match cloud account)
 * @param accessToken - Optional: provide access token from current session
 */
export async function syncEventsFromCloud(userEmail: string, accessToken?: string): Promise<CloudEvent[]> {
  try {
    console.log('🌐 Syncing events from cloud for:', userEmail);
    const cloudSupabase = getCloudClient();
    let userId: string;

    // 1. Authenticate with Cloud
    if (accessToken) {
      const { data: { user }, error: authError } = await cloudSupabase.auth.getUser(accessToken);
      if (authError || !user) throw new Error('Invalid access token');
      userId = user.id;
      console.log('✅ Using provided token for:', user.email);
    } else {
      const { data: { user }, error: authError } = await cloudSupabase.auth.getUser();
      if (authError || !user) {
        console.warn('⚠️ No cloud authentication found.');
        throw new Error('Cloud authentication required. Please login online first.');
      }
      userId = user.id;
      console.log('✅ Cloud user authenticated:', user.email);
    }

    // 2. Fetch Events
    const { data: events, error: fetchError } = await cloudSupabase
      .from('events')
      .select(`
        id, name, organizer, status, start_date, end_date, 
        user_id, created_at, categories, judges, config,
        event_last_config(event_id, event_name, division, round, heat_number, updated_at, judges)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (fetchError) throw fetchError;
    console.log(`✅ Fetched ${events?.length || 0} events from cloud`);

    // 3. Fetch Participants & Heats for these events
    const eventIds = (events || []).map(e => e.id);
    let allParticipants: CloudParticipant[] = [];

    // We will push data to Local DB if configured
    const canWriteToLocalDB = isSupabaseConfigured() && supabase;
    if (canWriteToLocalDB) {
      console.log('🔄 Syncing data to Local Supabase DB...');
    } else {
      console.warn('⚠️ Local Supabase not configured. Only syncing to LocalStorage.');
    }

    if (eventIds.length > 0) {
      // Fetch Participants
      const { data: participants, error: partError } = await cloudSupabase
        .from('participants')
        .select('*')
        .in('event_id', eventIds);

      if (!partError && participants) {
        allParticipants = participants;
        console.log(`✅ Fetched ${participants.length} participants`);
      }

      // Fetch Heats (including entries)
      // Note: fetching hierarchically to ensure we get everything
      const { data: heats, error: heatsError } = await cloudSupabase
        .from('heats')
        .select(`
            *,
            heat_entries(*),
            heat_slot_mappings(*)
        `)
        .in('event_id', eventIds);

      if (heatsError) console.warn('⚠️ Error fetching heats:', heatsError);
      else console.log(`✅ Fetched ${heats?.length || 0} heats`);

      // 4. WRITE TO LOCAL DB
      if (canWriteToLocalDB && supabase) {
        // Upsert Events
        const eventsPayload = events!.map(e => ({
          id: e.id,
          name: e.name,
          organizer: e.organizer,
          status: e.status,
          start_date: e.start_date,
          end_date: e.end_date,
          user_id: e.user_id, // Keep original user_id or map to local? Keeping matches structure.
          created_at: e.created_at,
          categories: e.categories,
          judges: e.judges,
          config: e.config
        }));
        const { error: eventUpsertErr } = await supabase.from('events').upsert(eventsPayload);
        if (eventUpsertErr) console.error('❌ Failed to upsert events to local DB:', eventUpsertErr);

        // Upsert Participants
        if (participants && participants.length > 0) {
          const { error: partUpsertErr } = await supabase.from('participants').upsert(participants);
          if (partUpsertErr) console.error('❌ Failed to upsert participants:', partUpsertErr);
        }

        // Upsert Heats & Children
        if (heats && heats.length > 0) {
          // Flatten heats for insertion
          const heatsPayload = heats.map(h => {
            const { heat_entries, heat_slot_mappings, ...heatData } = h;
            return heatData;
          });
          const { error: heatUpsertErr } = await supabase.from('heats').upsert(heatsPayload);
          if (heatUpsertErr) console.error('❌ Failed to upsert heats:', heatUpsertErr);

          // Entries
          const entriesPayload = heats.flatMap(h => h.heat_entries || []);
          if (entriesPayload.length > 0) {
            const { error: entriesErr } = await supabase.from('heat_entries').upsert(entriesPayload);
            if (entriesErr) console.error('❌ Failed to upsert heat entries:', entriesErr);
          }

          // Slot Mappings
          const mappingsPayload = heats.flatMap(h => h.heat_slot_mappings || []);
          if (mappingsPayload.length > 0) {
            const { error: mapErr } = await supabase.from('heat_slot_mappings').upsert(mappingsPayload);
            if (mapErr) console.error('❌ Failed to upsert mappings:', mapErr);
          }
        }

        // Upsert Event Last Config
        const configsPayload = events!
          .filter(e => e.event_last_config) // Some might be null
          .map(e => {
            // Ensure event_last_config is an object, not array (Supabase sometimes returns array for 1:1)
            const conf = Array.isArray(e.event_last_config) ? e.event_last_config[0] : e.event_last_config;
            if (!conf) return null;
            return {
              event_id: conf.event_id,
              event_name: conf.event_name,
              division: conf.division,
              round: conf.round,
              heat_number: conf.heat_number,
              updated_at: conf.updated_at,
              judges: conf.judges
            };
          })
          .filter(c => c !== null);

        if (configsPayload.length > 0) {
          // Using RPC for config upsert if table RLS/policies are strict, or direct upsert
          const { error: confErr } = await supabase.from('event_last_config').upsert(configsPayload);
          if (confErr) {
            console.warn('⚠️ Direct upsert of config failed, trying RPC...', confErr);
            // Fallback to RPC if direct fails
            for (const conf of configsPayload) {
              await supabase.rpc('upsert_event_last_config', {
                p_event_id: conf.event_id,
                p_event_name: conf.event_name,
                p_division: conf.division,
                p_round: conf.round,
                p_heat_number: conf.heat_number,
                p_judges: conf.judges || []
              });
            }
          }
        }
        console.log('💾✅ Data successfully synced to Local Supabase DB');
      }
    }

    // 5. Store in localStorage (Legacy/fallback support)
    const eventsToStore = events || [];
    localStorage.setItem(CLOUD_EVENTS_KEY, JSON.stringify(eventsToStore));
    localStorage.setItem(CLOUD_PARTICIPANTS_KEY, JSON.stringify(allParticipants));
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

    return eventsToStore as CloudEvent[];
  } catch (error) {
    console.error('❌ Failed to sync events from cloud:', error);
    throw error;
  }
}

/**
 * Get cached cloud events from localStorage
 */
export function getCachedCloudEvents(): CloudEvent[] {
  try {
    const stored = localStorage.getItem(CLOUD_EVENTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error reading cached events:', error);
    return [];
  }
}

/**
 * Get cached cloud participants from localStorage
 */
export function getCachedCloudParticipants(eventId?: number): CloudParticipant[] {
  try {
    const stored = localStorage.getItem(CLOUD_PARTICIPANTS_KEY);
    if (!stored) return [];
    const allParticipants = JSON.parse(stored) as CloudParticipant[];

    // Filter by event ID if provided
    if (eventId !== undefined) {
      return allParticipants.filter(p => p.event_id === eventId);
    }

    return allParticipants;
  } catch (error) {
    console.error('Error reading cached participants:', error);
    return [];
  }
}

/**
 * Get last sync timestamp
 */
export function getLastSyncTime(): Date | null {
  try {
    const stored = localStorage.getItem(LAST_SYNC_KEY);
    if (!stored) return null;
    return new Date(stored);
  } catch {
    return null;
  }
}

/**
 * Clear cached events and participants
 */
export function clearCachedEvents(): void {
  localStorage.removeItem(CLOUD_EVENTS_KEY);
  localStorage.removeItem(CLOUD_PARTICIPANTS_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
  console.log('🗑️ Cached events and participants cleared');
}

/**
 * Check if sync is needed (more than 24 hours)
 */
export function needsCloudSync(): boolean {
  const lastSync = getLastSyncTime();
  if (!lastSync) return true;

  const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
  return hoursSinceSync > 24;
}
