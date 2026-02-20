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

type CloudHeat = {
  id: string;
  event_id: number;
  competition?: string | null;
  division?: string | null;
  round?: number | null;
  heat_number?: number | null;
  heat_size?: number | null;
  status?: string | null;
  color_order?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  is_active?: boolean | null;
  heat_entries?: Array<Record<string, unknown>>;
  heat_slot_mappings?: Array<Record<string, unknown>>;
};

type SyncIssue = {
  step: string;
  message: string;
};

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
      detectSessionInUrl: true
    }
  });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function pickDefined<T extends Record<string, unknown>>(row: T, allowedKeys: string[]) {
  return allowedKeys.reduce<Record<string, unknown>>((acc, key) => {
    const value = row[key];
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});
}

function normalizeHeatStatus(status?: string | null) {
  const raw = (status || '').toLowerCase();
  if (raw === 'open') return 'waiting';
  if (raw === 'waiting' || raw === 'running' || raw === 'paused' || raw === 'finished' || raw === 'closed') {
    return raw;
  }
  return 'waiting';
}

async function withRetry<T>(fn: () => Promise<T>, step: string, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxAttempts) break;
      const backoffMs = 250 * Math.pow(2, attempt - 1);
      console.warn(`⚠️ ${step} failed (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms`, error);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
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
      try {
        const { data: { user }, error: authError } = await cloudSupabase.auth.getUser(accessToken);
        if (authError || !user) throw new Error('Invalid access token');
        userId = user.id;
        console.log('✅ Using provided token for:', user.email);
      } catch (err: any) {
        if (err?.message === 'Failed to fetch') {
          throw new Error('Erreur réseau Cloud : Internet est requis pour vérifier votre connexion.');
        }
        throw new Error('Votre session Cloud est invalide. Veuillez vous reconnecter.');
      }
    } else {
      try {
        const { data: { user }, error: authError } = await cloudSupabase.auth.getUser();
        if (authError || !user) {
          console.warn('⚠️ No cloud authentication found.');
          throw new Error('Connexion Cloud requise. Veuillez vous connecter pour synchroniser.');
        }
        userId = user.id;
        console.log('✅ Cloud user authenticated:', user.email);
      } catch (err: any) {
        if (err?.message === 'Failed to fetch') {
          throw new Error('Erreur réseau Cloud : Internet est requis. Vérifiez votre partage de connexion.');
        }
        // If it's an actual auth error (like 401), re-throw a friendly version
        if (err?.message?.includes('token') || err?.message?.includes('auth')) {
          throw new Error('Votre session Cloud a expiré. Veuillez vous reconnecter.');
        }
        throw err;
      }
    }

    // 2. Fetch Events (Select * to ensure we get all metadata expected by local DB)
    const { data: events, error: fetchError } = await withRetry(
      () =>
        cloudSupabase
          .from('events')
          .select(`
            id, name, organizer, status, start_date, end_date, user_id, created_at, updated_at,
            price, currency, method, paid, paid_at, payment_ref, categories, judges, config,
            event_last_config(event_id, event_name, division, round, heat_number, updated_at, judges)
          `)
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      'Fetch cloud events'
    );

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

    let localSyncError = false;

    if (eventIds.length > 0) {
      const syncIssues: SyncIssue[] = [];

      // Fetch Participants
      const { data: participants, error: partError } = await withRetry(
        () =>
          cloudSupabase
            .from('participants')
            .select('id, event_id, seed, name, category, country, license, created_at, updated_at')
            .in('event_id', eventIds),
        'Fetch cloud participants'
      );

      if (!partError && participants) {
        allParticipants = participants;
        console.log(`✅ Fetched ${participants.length} participants`);
      }

      // Fetch Heats (including entries)
      const { data: heats, error: heatsError } = await withRetry(
        () =>
          cloudSupabase
            .from('heats')
            .select(`
              id, event_id, competition, division, round, heat_number, heat_size, status, color_order, created_at, updated_at, closed_at, is_active,
              heat_entries(id, heat_id, participant_id, position, seed, color, created_at),
              heat_slot_mappings(id, heat_id, position, placeholder, source_round, source_heat, source_position, created_at)
            `)
            .in('event_id', eventIds),
        'Fetch cloud heats'
      );

      if (heatsError) console.warn('⚠️ Error fetching heats:', heatsError);
      else console.log(`✅ Fetched ${heats?.length || 0} heats`);

      // 4. WRITE TO LOCAL DB
      if (canWriteToLocalDB && supabase) {
        // 4a) Events first (parent table)
        const eventsPayload = (events || []).map((eventRow: Record<string, unknown>) => {
          const { event_last_config, ...eventData } = eventRow;
          return pickDefined(
            {
              ...eventData,
              organizer: eventData.organizer ?? '',
              status: eventData.status ?? 'paid',
              price: eventData.price ?? 0,
              currency: eventData.currency ?? 'XOF',
              categories: eventData.categories ?? [],
              judges: eventData.judges ?? [],
              config: eventData.config ?? {},
            },
            [
              'id', 'name', 'organizer', 'status', 'start_date', 'end_date', 'user_id', 'created_at', 'updated_at',
              'price', 'currency', 'method', 'paid', 'paid_at', 'payment_ref', 'categories', 'judges', 'config'
            ]
          );
        });

        for (const batch of chunkArray(eventsPayload, 100)) {
          const { error } = await withRetry(
            () => supabase.from('events').upsert(batch, { onConflict: 'id' }),
            'Upsert local events'
          );
          if (error) {
            syncIssues.push({ step: 'events', message: error.message });
            localSyncError = true;
          }
        }

        // 4b) Participants
        if (participants && participants.length > 0) {
          const participantsPayload = participants.map((participant: Record<string, unknown>) =>
            pickDefined(
              {
                ...participant,
                seed: participant.seed ?? 0,
                category: participant.category ?? 'OPEN',
                name: participant.name ?? 'UNKNOWN',
              },
              ['id', 'event_id', 'seed', 'name', 'category', 'country', 'license', 'created_at', 'updated_at']
            )
          );

          for (const batch of chunkArray(participantsPayload, 500)) {
            const { error } = await withRetry(
              () => supabase.from('participants').upsert(batch, { onConflict: 'id' }),
              'Upsert local participants'
            );
            if (error) {
              syncIssues.push({ step: 'participants', message: error.message });
              localSyncError = true;
            }
          }
        }

        // 4c) Heats + children
        const cloudHeats = (heats || []) as CloudHeat[];
        if (cloudHeats.length > 0) {
          const heatsPayload = cloudHeats.map((heat) =>
            pickDefined(
              {
                ...heat,
                status: normalizeHeatStatus(heat.status),
                round: heat.round ?? 1,
                heat_number: heat.heat_number ?? 1,
                division: heat.division ?? 'OPEN',
                competition: heat.competition ?? '',
              },
              [
                'id', 'event_id', 'competition', 'division', 'round', 'heat_number', 'heat_size', 'status',
                'color_order', 'created_at', 'updated_at', 'closed_at', 'is_active'
              ]
            )
          );

          for (const batch of chunkArray(heatsPayload, 200)) {
            const { error } = await withRetry(
              () => supabase.from('heats').upsert(batch, { onConflict: 'id' }),
              'Upsert local heats'
            );
            if (error) {
              syncIssues.push({ step: 'heats', message: error.message });
              localSyncError = true;
            }
          }

          const allHeatIds = cloudHeats.map((heat) => heat.id).filter(Boolean);

          // Replace entries per heat to avoid PK/sequence mismatches.
          for (const heatId of allHeatIds) {
            const entriesForHeat = cloudHeats
              .find((heat) => heat.id === heatId)
              ?.heat_entries ?? [];

            const { error: deleteError } = await supabase
              .from('heat_entries')
              .delete()
              .eq('heat_id', heatId);

            if (deleteError) {
              syncIssues.push({ step: `heat_entries_delete:${heatId}`, message: deleteError.message });
              localSyncError = true;
              continue;
            }

            if (entriesForHeat.length > 0) {
              const payload = entriesForHeat.map((entry) =>
                pickDefined(
                  {
                    ...entry,
                    heat_id: heatId,
                    position: Number(entry.position ?? 0),
                    seed: Number(entry.seed ?? entry.position ?? 0),
                  } as Record<string, unknown>,
                  ['heat_id', 'participant_id', 'position', 'seed', 'color', 'created_at']
                )
              );

              const validRows = payload.filter((row) => Number(row.position) > 0);
              if (validRows.length > 0) {
                const { error } = await supabase.from('heat_entries').insert(validRows);
                if (error) {
                  syncIssues.push({ step: `heat_entries_insert:${heatId}`, message: error.message });
                  localSyncError = true;
                }
              }
            }
          }

          // Replace mappings per heat.
          for (const heatId of allHeatIds) {
            const mappingsForHeat = cloudHeats
              .find((heat) => heat.id === heatId)
              ?.heat_slot_mappings ?? [];

            const { error: deleteError } = await supabase
              .from('heat_slot_mappings')
              .delete()
              .eq('heat_id', heatId);

            if (deleteError) {
              syncIssues.push({ step: `heat_slot_mappings_delete:${heatId}`, message: deleteError.message });
              localSyncError = true;
              continue;
            }

            if (mappingsForHeat.length > 0) {
              const payload = mappingsForHeat.map((mapping) =>
                pickDefined(
                  {
                    ...mapping,
                    heat_id: heatId,
                    position: Number(mapping.position ?? 0),
                  } as Record<string, unknown>,
                  ['heat_id', 'position', 'placeholder', 'source_round', 'source_heat', 'source_position', 'created_at']
                )
              );

              const validRows = payload.filter((row) => Number(row.position) > 0);
              if (validRows.length > 0) {
                const { error } = await supabase.from('heat_slot_mappings').insert(validRows);
                if (error) {
                  syncIssues.push({ step: `heat_slot_mappings_insert:${heatId}`, message: error.message });
                  localSyncError = true;
                }
              }
            }
          }
        }

        // 4d) Scores sync (important for offline continuity)
        const { data: scoresRows, error: scoresFetchError } = await cloudSupabase
          .from('scores')
          .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
          .in('event_id', eventIds);

        if (scoresFetchError) {
          syncIssues.push({ step: 'scores_fetch', message: scoresFetchError.message });
        } else if (scoresRows && scoresRows.length > 0) {
          for (const batch of chunkArray(scoresRows, 1000)) {
            const { error } = await supabase.from('scores').upsert(batch, { onConflict: 'id' });
            if (error) {
              syncIssues.push({ step: 'scores_upsert', message: error.message });
              localSyncError = true;
              break;
            }
          }
        }

        // 4e) Event Last Config
        const configsPayload = events!
          .filter(e => e.event_last_config)
          .map(e => {
            const conf = Array.isArray(e.event_last_config) ? e.event_last_config[0] : e.event_last_config;
            if (!conf) return null;
            return {
              event_id: conf.event_id,
              event_name: conf.event_name || (e as Record<string, unknown>).name || '',
              division: conf.division || 'OPEN',
              round: conf.round ?? 1,
              heat_number: conf.heat_number ?? 1,
              updated_at: conf.updated_at,
              judges: conf.judges || []
            };
          })
          .filter((c): c is {
            event_id: number;
            event_name: string;
            division: string;
            round: number;
            heat_number: number;
            updated_at?: string;
            judges: unknown[];
          } => c !== null);

        if (configsPayload.length > 0) {
          const { error: confErr } = await supabase.from('event_last_config').upsert(configsPayload, { onConflict: 'event_id' });
          if (confErr) {
            console.warn('⚠️ Direct upsert of config failed, trying RPC fallback...');
            for (const conf of configsPayload) {
              const { error: rpcErr } = await supabase.rpc('upsert_event_last_config', {
                p_event_id: conf.event_id,
                p_event_name: conf.event_name,
                p_division: conf.division,
                p_round: conf.round,
                p_heat_number: conf.heat_number,
                p_judges: conf.judges || []
              });
              if (rpcErr) {
                syncIssues.push({ step: `event_last_config_rpc:${conf.event_id}`, message: rpcErr.message });
                localSyncError = true;
              }
            }
          }
        }

        if (!localSyncError) {
          console.log('💾✅ Data successfully synced to Local Supabase DB');
        } else {
          console.warn('⚠️ Data sync completed with errors:', syncIssues);
          const summary = syncIssues
            .slice(0, 3)
            .map((issue) => `${issue.step}: ${issue.message}`)
            .join(' | ');
          throw new Error(`Sync local partiel: ${summary}`);
        }
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
