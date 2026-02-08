/**
 * Sync Cloud Events to Local Storage
 *
 * This utility syncs events from cloud Supabase to local storage
 * for offline/dev work. Events are cached and can be used without internet.
 */

import { createClient } from '@supabase/supabase-js';

const CLOUD_EVENTS_KEY = 'surfjudging_cloud_events';
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

/**
 * Get cloud Supabase client
 */
function getCloudClient() {
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
 */
export async function syncEventsFromCloud(userEmail: string): Promise<CloudEvent[]> {
  try {
    console.log('🌐 Syncing events from cloud for:', userEmail);

    const cloudSupabase = getCloudClient();

    // First, authenticate to get user ID
    // Note: This requires the user to have logged in at least once to cloud
    const { data: { user }, error: authError } = await cloudSupabase.auth.getUser();

    if (authError || !user) {
      console.warn('⚠️ No cloud authentication found. User needs to login to cloud first.');
      throw new Error('Cloud authentication required. Please login online first.');
    }

    console.log('✅ Cloud user authenticated:', user.email);

    // Fetch events for this user
    const { data: events, error: fetchError } = await cloudSupabase
      .from('events')
      .select('id, name, organizer, status, start_date, end_date, user_id, created_at, event_last_config(event_id, event_name, division, round, heat_number, updated_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Error fetching cloud events:', fetchError);
      throw fetchError;
    }

    console.log(`✅ Fetched ${events?.length || 0} events from cloud`);

    // Store in localStorage
    const eventsToStore = events || [];
    localStorage.setItem(CLOUD_EVENTS_KEY, JSON.stringify(eventsToStore));
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

    console.log('💾 Events cached to localStorage');

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
 * Clear cached events
 */
export function clearCachedEvents(): void {
  localStorage.removeItem(CLOUD_EVENTS_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
  console.log('🗑️ Cached events cleared');
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
