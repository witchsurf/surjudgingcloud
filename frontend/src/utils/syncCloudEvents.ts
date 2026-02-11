/**
 * Sync Cloud Events to Local Storage
 *
 * This utility syncs events and participants from cloud Supabase to local storage
 * for offline/dev work. Data is cached and can be used without internet.
 */

import { createClient } from '@supabase/supabase-js';

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

/**
 * Get cloud Supabase client
 */
export function getCloudClient() {
  const url = import.meta.env.VITE_SUPABASE_URL_CLOUD;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY_CLOUD;

  if (!url || !key) {
    throw new Error('Cloud Supabase credentials not configured');
  }

  return createClient(url, key);
}

/**
 * Sync events from cloud to local storage
 * @param userEmail - Email of the user (used to match cloud account)
 * @param accessToken - Optional: provide access token from current session
 */
export async function syncEventsFromCloud(userEmail: string, accessToken?: string): Promise<CloudEvent[]> {
  try {
    console.log('🌐 Syncing events from cloud for:', userEmail);

    const cloudSupabase = getCloudClient();

    let userId: string;

    // Try to get user from provided token or current session
    if (accessToken) {
      // Use provided token
      const { data: { user }, error: authError } = await cloudSupabase.auth.getUser(accessToken);
      if (authError || !user) {
        throw new Error('Invalid access token');
      }
      userId = user.id;
      console.log('✅ Using provided token for:', user.email);
    } else {
      // Try current session
      const { data: { user }, error: authError } = await cloudSupabase.auth.getUser();

      if (authError || !user) {
        console.warn('⚠️ No cloud authentication found. User needs to login to cloud first.');
        throw new Error('Cloud authentication required. Please login online first.');
      }
      userId = user.id;
      console.log('✅ Cloud user authenticated:', user.email);
    }

    // Fetch events for this user
    const { data: events, error: fetchError } = await cloudSupabase
      .from('events')
      .select('id, name, organizer, status, start_date, end_date, user_id, created_at, event_last_config(event_id, event_name, division, round, heat_number, updated_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Error fetching cloud events:', fetchError);
      throw fetchError;
    }

    console.log(`✅ Fetched ${events?.length || 0} events from cloud`);

    // Fetch participants for all events
    const eventIds = (events || []).map(e => e.id);
    let allParticipants: CloudParticipant[] = [];

    if (eventIds.length > 0) {
      const { data: participants, error: participantsError } = await cloudSupabase
        .from('participants')
        .select('id, event_id, seed, name, category, country, license')
        .in('event_id', eventIds)
        .order('seed', { ascending: true });

      if (participantsError) {
        console.warn('⚠️ Error fetching participants (continuing without them):', participantsError);
      } else {
        allParticipants = participants || [];
        console.log(`✅ Fetched ${allParticipants.length} participants from cloud`);
      }
    }

    // Store in localStorage
    const eventsToStore = events || [];
    localStorage.setItem(CLOUD_EVENTS_KEY, JSON.stringify(eventsToStore));
    localStorage.setItem(CLOUD_PARTICIPANTS_KEY, JSON.stringify(allParticipants));
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

    console.log('💾 Events and participants cached to localStorage');

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
