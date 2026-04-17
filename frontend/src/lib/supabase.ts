import { createClient } from '@supabase/supabase-js';
import { getColorSet } from '../utils/colorUtils';

type SupabaseMode = 'cloud' | 'local' | null;

const SUPABASE_MODE_STORAGE_KEY = 'supabase_mode';
const SUPABASE_URL_OVERRIDE_KEY = 'supabase_url_override';
const SUPABASE_ANON_OVERRIDE_KEY = 'supabase_anon_override';
const SUPABASE_CLOUD_LOCK_KEY = 'supabase_cloud_lock';

const resolveEnv = (key: string): string | undefined => {
  return (import.meta as { env?: Record<string, string> }).env?.[key];
};

const readStored = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const getSupabaseMode = (): SupabaseMode => {
  const stored = readStored(SUPABASE_MODE_STORAGE_KEY);
  return stored === 'cloud' || stored === 'local' ? stored : null;
};

export const isCloudLocked = (): boolean => {
  return readStored(SUPABASE_CLOUD_LOCK_KEY) === 'true';
};

export const setCloudLocked = (locked: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    if (locked) {
      window.localStorage.setItem(SUPABASE_CLOUD_LOCK_KEY, 'true');
    } else {
      window.localStorage.removeItem(SUPABASE_CLOUD_LOCK_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

export const setSupabaseMode = (mode: SupabaseMode) => {
  if (typeof window === 'undefined') return;
  try {
    if (!mode) {
      window.localStorage.removeItem(SUPABASE_MODE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SUPABASE_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
};

export const setSupabaseOverrides = (url?: string, anonKey?: string) => {
  if (typeof window === 'undefined') return;
  try {
    if (url) {
      window.localStorage.setItem(SUPABASE_URL_OVERRIDE_KEY, url);
    } else {
      window.localStorage.removeItem(SUPABASE_URL_OVERRIDE_KEY);
    }
    if (anonKey) {
      window.localStorage.setItem(SUPABASE_ANON_OVERRIDE_KEY, anonKey);
    } else {
      window.localStorage.removeItem(SUPABASE_ANON_OVERRIDE_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

export const getSupabaseConfig = () => {
  const storedMode = getSupabaseMode();
  const cloudLocked = isCloudLocked();
  let mode = cloudLocked ? 'local' : storedMode;
  const overrideUrl = readStored(SUPABASE_URL_OVERRIDE_KEY);
  const overrideAnon = readStored(SUPABASE_ANON_OVERRIDE_KEY);

  // FORCE local mode when served from a private/local network IP
  // This takes priority over whatever localStorage may have saved from a previous session
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isServedFromLocalNetwork =
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';

  if (isServedFromLocalNetwork) {
    mode = 'local';
  } else if (!mode) {
    // Auto-detect mode from env/override URL only if not already set
    const currentUrl = overrideUrl || resolveEnv('VITE_SUPABASE_URL') || window.location.origin;
    if (currentUrl.includes('192.168') || currentUrl.includes('10.0.0') || currentUrl.includes('localhost') || currentUrl.includes(':8000') || currentUrl.includes(':8080')) {
      mode = 'local';
    } else {
      mode = 'cloud';
    }
  }

  const isLocalDevice = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

  const dynamicLocalUrl = isLocalDevice
    ? `http://${window.location.hostname}:8000`
    : (resolveEnv('VITE_SUPABASE_URL_LAN') || resolveEnv('VITE_SUPABASE_URL_LOCAL'));

  const urlFromMode =
    mode === 'local'
      ? dynamicLocalUrl
      : resolveEnv('VITE_SUPABASE_URL_CLOUD');

  const anonFromMode =
    mode === 'local'
      ? resolveEnv('VITE_SUPABASE_ANON_KEY_LAN') || resolveEnv('VITE_SUPABASE_ANON_KEY_LOCAL')
      : resolveEnv('VITE_SUPABASE_ANON_KEY_CLOUD');

  const supabaseUrl =
    overrideUrl ||
    urlFromMode ||
    resolveEnv('VITE_SUPABASE_URL');

  const supabaseAnonKey =
    overrideAnon ||
    anonFromMode ||
    resolveEnv('VITE_SUPABASE_ANON_KEY');

  return {
    supabaseUrl,
    supabaseAnonKey,
    mode,
  };
};

export const { supabaseUrl, supabaseAnonKey, mode } = getSupabaseConfig();
const debugRealtimeEnabled = resolveEnv('VITE_DEBUG_REALTIME') === 'true';
const isVitestRuntime =
  resolveEnv('VITEST') === 'true'
  || resolveEnv('MODE') === 'test';

export const isLocalSupabaseMode = (): boolean => {
  return getSupabaseConfig().mode === 'local';
};

export const canUseSupabaseConnection = (): boolean => {
  if (!isSupabaseConfigured() || !supabase) return false;
  if (typeof window === 'undefined') return true;
  return isLocalSupabaseMode() || window.navigator.onLine;
};

console.log(`🔌 Supabase Mode: ${mode}`);
console.log(`🔗 Supabase URL: ${supabaseUrl}`);
console.log(`🔑 Supabase Key (local): ${mode === 'local' ? (supabaseAnonKey?.substring(0, 15) + '...') : 'N/A'}`);

// Créer le client Supabase seulement si les variables d'environnement sont valides
export const supabase =
  supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined'
    ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Use strictly separate storage keys to avoid session bleeding
        storageKey: mode === 'local'
          ? 'surfjudging-local-auth-token'
          : `surfjudging-cloud-auth-token`,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        worker: !isVitestRuntime,
        heartbeatIntervalMs: 15000,
        heartbeatCallback: (status) => {
          if (typeof window !== 'undefined') {
            ((window as typeof window & { __surfRealtimeDebug?: Record<string, unknown> }).__surfRealtimeDebug ??= {}).heartbeatStatus = {
              status,
              updatedAt: new Date().toISOString(),
            };
          }

          if (status === 'timeout' || status === 'disconnected') {
            console.warn(`⚠️ Supabase heartbeat ${status}`);
          }
        },
        ...(debugRealtimeEnabled
          ? {
            logLevel: 'info' as const,
            logger: (kind: string, msg: string, data?: unknown) => {
              console.log(`[realtime:${kind}] ${msg}`, data ?? '');
            },
          }
          : {}),
      },
    })
    : null;

// Fonction pour vérifier si Supabase est configuré
export const isSupabaseConfigured = () => {
  return !!(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'undefined' &&
    supabaseAnonKey !== 'undefined' &&
    supabase
  );
};

// Types pour la base de données
export interface DatabaseHeat {
  id: string;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  status: 'open' | 'closed';
  created_at: string;
  closed_at?: string;
}

export interface DatabaseScore {
  id: string;
  heat_id: string;
  competition: string;
  division: string;
  round: number;
  judge_id: string;
  judge_name: string;
  judge_station?: string;
  judge_identity_id?: string;
  surfer: string;
  wave_number: number;
  score: number;
  timestamp: string;
  created_at: string;
  synced: boolean;
}

// Interface pour les heats générés
export interface GeneratedHeat {
  id: string;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  status: 'open' | 'closed';
  created_at: string;
  closed_at?: string;
}

function resolveHeatNumber(heat: any): number {
  const raw = heat?.heatNumber ?? heat?.heat_number ?? heat?.number ?? heat?.heatNo;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

// Fonction pour sauvegarder les heats dans la base
export async function saveHeatsToDatabase(heats: any, eventId: string) {
  const competitionId = eventId || heats.eventId;

  // Try to read numeric event DB id saved during event creation in the app
  let eventDbId: number | null = null;
  try {
    const ev = JSON.parse(localStorage.getItem('eventData') || 'null');
    if (ev && (ev.eventDbId || ev.event_db_id || ev.event_id)) {
      eventDbId = ev.eventDbId || ev.event_db_id || ev.event_id;
    }
  } catch (err) {
    // ignore
  }

  if (!isSupabaseConfigured() || !supabase) {
    // Fallback mode hors-ligne
    // Prepare payload for offline save — mirror the online formatting (infer division, normalize fields)
    const offlinePayload = heats.rounds.map((round: any) =>
      round.heats.map((heat: any) => ({
        id: `${competitionId}_${heat.round}_H${resolveHeatNumber(heat)}`,
        competition: competitionId,
        division: heat.division || heat.division_name || (() => {
          try {
            const participants = JSON.parse(localStorage.getItem('participants') || '[]');
            if (Array.isArray(participants) && participants.length > 0) {
              const counts: Record<string, number> = {};
              participants.forEach((p: any) => { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1; });
              const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              return sorted.length ? sorted[0][0] : 'OPEN';
            }
          } catch (err) { }
          return 'OPEN';
        })(),
        round: heat.round,
        heat_number: resolveHeatNumber(heat),
        status: 'open',
        event_id: eventDbId || null,
        created_at: new Date().toISOString()
      }))
    ).flat();

    saveOffline({
      table: 'heats',
      action: 'insert',
      payload: offlinePayload,
      timestamp: Date.now()
    });
    return null;
  }

  const formattedHeats = heats.rounds.map((round: any) =>
    round.heats.map((heat: any) => ({
      id: `${competitionId}_${heat.round}_H${resolveHeatNumber(heat)}`,
      // Prefer the human-readable event name saved in localStorage at event creation time
      // fall back to the event string id if no name is available
      competition: (() => {
        try {
          const ev = JSON.parse(localStorage.getItem('eventData') || 'null');
          if (ev && ev.name) return ev.name;
        } catch (err) {
          // ignore
        }
        return competitionId;
      })(),
      // Try to use heat.division if provided, otherwise infer from participants stored locally
      division: heat.division || heat.division_name || (() => {
        try {
          const participants = JSON.parse(localStorage.getItem('participants') || '[]');
          if (Array.isArray(participants) && participants.length > 0) {
            // Most common category among participants
            const counts: Record<string, number> = {};
            participants.forEach((p: any) => { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1; });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            return sorted.length ? sorted[0][0] : 'OPEN';
          }
        } catch (err) {
          // ignore
        }
        return 'OPEN';
      })(),
      round: heat.round,
      heat_number: resolveHeatNumber(heat),
      status: 'open',
      // set event_id to numeric DB id if available
      event_id: eventDbId || null,
      created_at: new Date().toISOString()
    }))
  ).flat();

  // Avoid inserting duplicate primary keys: check which heat IDs already exist
  const ids = formattedHeats.map((h: any) => h.id);
  const { data: existingIds, error: fetchErr } = await supabase
    .from('heats')
    .select('id')
    .in('id', ids);

  if (fetchErr) throw fetchErr;

  const existingIdSet = new Set((existingIds || []).map((r: any) => r.id));
  const toInsert = formattedHeats.filter((h: any) => !existingIdSet.has(h.id));

  if (toInsert.length === 0) {
    // Nothing new to insert — return the existing records for these heats
    const { data: existingRecords, error: existingErr } = await supabase
      .from('heats')
      .select('*')
      .in('id', ids);

    if (existingErr) throw existingErr;
    return existingRecords;
  }

  const { data, error } = await supabase
    .from('heats')
    .insert(toInsert)
    .select();

  if (error) throw error;
  return data;
}

// Fonction pour récupérer les heats d'une compétition
export async function getHeatsForCompetition(competitionId: string) {
  if (!isSupabaseConfigured() || !supabase) {
    // Récupérer depuis le stockage local
    const entries = getOffline().filter(e => e.table === 'heats');
    // Trouver les entrées dont la charge utile contient des heats pour cette compétition
    for (const entry of entries) {
      const p = entry.payload;
      if (Array.isArray(p)) {
        if (p.some((h: any) => h.competition === competitionId)) {
          return p.filter((h: any) => h.competition === competitionId);
        }
      } else if (p && p.competition === competitionId) {
        return p;
      }
    }
    return null;
  }

  const { data, error } = await supabase
    .from('heats')
    .select('*')
    .eq('competition', competitionId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data[0] || null;
}
// --------------------------------------------------
// 🔄 Fallback Offline pour fonctionnement hors ligne
// --------------------------------------------------

interface OfflineEntry {
  table: string
  action: 'insert' | 'update' | 'delete' | 'upsert'
  payload: any
  timestamp: number
}

const OFFLINE_KEY = 'surfapp_offline_queue'
const HEAT_CONFIG_REPAIR_TABLE = '__heat_config_repair__'

// Sauvegarder une action hors ligne
export function saveOffline(entry: OfflineEntry) {
  const queue: OfflineEntry[] = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
  queue.push(entry)
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(queue))
}

// Récupérer la queue offline
export function getOffline(): OfflineEntry[] {
  return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
}

function applyOfflineFilters(query: any, filter: Record<string, unknown>) {
  let nextQuery = query
  for (const [column, value] of Object.entries(filter)) {
    if (Array.isArray(value)) {
      nextQuery = nextQuery.in(column, value)
    } else if (value === null) {
      nextQuery = nextQuery.is(column, null)
    } else {
      nextQuery = nextQuery.eq(column, value)
    }
  }
  return nextQuery
}

async function replayOfflineEntry(entry: OfflineEntry) {
  if (!supabase) {
    throw new Error('Supabase indisponible pour la synchronisation offline.')
  }

  if (entry.table === HEAT_CONFIG_REPAIR_TABLE) {
    await repairHeatConfigSnapshot(entry.payload)
    return
  }

  if (entry.table === 'heat_realtime_config' && (entry.action === 'upsert' || entry.action === 'update')) {
    const payload = entry.payload?.rows ?? entry.payload?.data ?? entry.payload ?? {}
    const heatId = String(payload?.heat_id ?? '').trim()

    if (!heatId) {
      throw new Error('Synchronisation offline heat_realtime_config sans heat_id')
    }

    const { error } = await supabase.rpc('upsert_heat_realtime_config', {
      p_heat_id: heatId,
      p_status: typeof payload?.status === 'string' ? payload.status : null,
      p_set_timer_start_time: Object.prototype.hasOwnProperty.call(payload, 'timer_start_time'),
      p_timer_start_time: Object.prototype.hasOwnProperty.call(payload, 'timer_start_time') ? payload.timer_start_time : null,
      p_set_timer_duration: Object.prototype.hasOwnProperty.call(payload, 'timer_duration_minutes'),
      p_timer_duration_minutes: Object.prototype.hasOwnProperty.call(payload, 'timer_duration_minutes') ? payload.timer_duration_minutes : null,
      p_set_config_data: Object.prototype.hasOwnProperty.call(payload, 'config_data'),
      p_config_data: Object.prototype.hasOwnProperty.call(payload, 'config_data') ? payload.config_data : null,
      p_updated_by: typeof payload?.updated_by === 'string' ? payload.updated_by : 'offline_sync',
    })

    if (error) {
      throw error
    }

    return
  }

  let error: unknown = null

  if (entry.action === 'insert') {
    const payload = entry.payload?.rows ?? entry.payload
    const options = entry.payload?.options ?? undefined
    const result = await supabase.from(entry.table).insert(payload, options)
    error = result.error
  } else if (entry.action === 'upsert') {
    const result = await supabase
      .from(entry.table)
      .upsert(entry.payload.rows ?? entry.payload, entry.payload.options ?? undefined)
    error = result.error
  } else if (entry.action === 'update') {
    const data = entry.payload?.data ?? {}
    let query = supabase.from(entry.table).update(data)
    if (entry.payload?.filter && typeof entry.payload.filter === 'object') {
      query = applyOfflineFilters(query, entry.payload.filter)
    } else if (entry.payload?.id !== undefined) {
      query = query.eq('id', entry.payload.id)
    } else {
      throw new Error(`Offline update sans filtre pour ${entry.table}`)
    }
    const result = await query
    error = result.error
  } else if (entry.action === 'delete') {
    let query = supabase.from(entry.table).delete()
    if (entry.payload?.filter && typeof entry.payload.filter === 'object') {
      query = applyOfflineFilters(query, entry.payload.filter)
    } else if (entry.payload?.id !== undefined) {
      query = query.eq('id', entry.payload.id)
    } else {
      throw new Error(`Offline delete sans filtre pour ${entry.table}`)
    }
    const result = await query
    error = result.error
  }

  if (error) {
    throw error
  }
}

async function repairHeatConfigSnapshot(payload: any) {
  if (!supabase) {
    throw new Error('Supabase indisponible pour réparer la config heat offline.')
  }

  const heatId = String(payload?.heat_id ?? payload?.heatId ?? '').trim()
  const config = payload?.config ?? {}
  const assignmentPayload = Array.isArray(payload?.assignments) ? payload.assignments : []

  if (!heatId) {
    return
  }

  const { data: heatMeta, error: heatError } = await supabase
    .from('heats')
    .select('id, event_id, competition, division, round, heat_number, heat_size, color_order')
    .eq('id', heatId)
    .maybeSingle()

  if (heatError) {
    throw heatError
  }
  if (!heatMeta) {
    return
  }

  const surfers = Array.isArray(config?.surfers)
    ? config.surfers.map((value: unknown) => String(value ?? '').trim().toUpperCase()).filter(Boolean)
    : []
  const surferNames = config?.surfer_names ?? config?.surferNames ?? {}
  const surferCountries = config?.surfer_countries ?? config?.surferCountries ?? {}

  if (surfers.length > 0) {
    const { data: participantRows, error: participantError } = await supabase
      .from('participants')
      .select('id, seed, name, country')
      .eq('event_id', heatMeta.event_id)
      .ilike('category', String(heatMeta.division ?? ''))
      .order('seed', { ascending: true })

    if (participantError) {
      throw participantError
    }

    const participantByName = new Map(
      (participantRows ?? []).map((participant: any) => [String(participant.name ?? '').trim().toLowerCase(), participant] as const)
    )

    const colorOrder = Array.isArray(heatMeta.color_order) && heatMeta.color_order.length > 0
      ? heatMeta.color_order
      : getColorSet(Number(heatMeta.heat_size) || surfers.length)

    const entryPayload = surfers.map((color: string, index: number) => {
      const resolvedName = String(surferNames?.[color] ?? '').trim()
      const matchedParticipant = resolvedName
        ? participantByName.get(resolvedName.toLowerCase()) ?? null
        : null

      return {
        heat_id: heatId,
        participant_id: matchedParticipant?.id ?? null,
        position: index + 1,
        seed: Number.isFinite(Number(matchedParticipant?.seed)) ? Number(matchedParticipant.seed) : index + 1,
        color: colorOrder[index] ?? color,
      }
    })

    const { error: entriesError } = await supabase
      .from('heat_entries')
      .upsert(entryPayload, { onConflict: 'heat_id,position' })

    if (entriesError) {
      throw entriesError
    }
  }

  const judgePayload = assignmentPayload.length > 0
    ? assignmentPayload.map((assignment: any) => ({
        id: assignment.station,
        name: assignment.judge_name ?? assignment.station,
        identity_id: assignment.judge_id ?? null,
      }))
    : (Array.isArray(config?.judges) ? config.judges : [])
        .map((stationRaw: unknown) => String(stationRaw ?? '').trim().toUpperCase())
        .filter(Boolean)
        .map((station: string) => ({
          id: station,
          name: String((config?.judge_names ?? config?.judgeNames ?? {})?.[station] ?? station).trim() || station,
          identity_id: (config?.judge_identities ?? config?.judgeIdentities ?? {})?.[station] ?? null,
        }))

  if (heatMeta.event_id && heatMeta.division && heatMeta.round && heatMeta.heat_number) {
    const { error: snapshotError } = await supabase.rpc('upsert_event_last_config', {
      p_event_id: heatMeta.event_id,
      p_event_name: String(config?.competition ?? heatMeta.competition ?? heatMeta.event_id).trim(),
      p_division: heatMeta.division,
      p_round: heatMeta.round,
      p_heat_number: heatMeta.heat_number,
      p_judges: judgePayload,
      p_surfers: surfers,
      p_surfer_names: surfers.reduce((acc: Record<string, string>, color: string) => {
        const resolved = String(surferNames?.[color] ?? '').trim()
        if (resolved) acc[color] = resolved
        return acc
      }, {}),
      p_surfer_countries: surfers.reduce((acc: Record<string, string>, color: string) => {
        const resolved = String(surferCountries?.[color] ?? '').trim()
        if (resolved) acc[color] = resolved
        return acc
      }, {}),
    })

    if (snapshotError) {
      throw snapshotError
    }
  }
}

// Synchroniser les actions offline dès que Supabase est dispo
export async function syncOffline() {
  if (!isSupabaseConfigured() || !supabase) return
  const queue = getOffline()
  if (queue.length === 0) return
  const failed: OfflineEntry[] = []

  const isBenignConflict = (entry: OfflineEntry, err: unknown) => {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code || '') : ''
    const message = typeof err === 'object' && err !== null && 'message' in err ? String((err as { message?: string }).message || '') : ''
    const duplicate = code === '23505' || code === '409' || /duplicate|conflict/i.test(message)
    if (!duplicate) return false
    return entry.table === 'heats' || entry.table === 'heat_configs' || entry.table === 'heat_realtime_config'
  }

  for (const entry of queue) {
    try {
      await replayOfflineEntry(entry)
    } catch (err) {
      if (isBenignConflict(entry, err)) {
        console.warn('⚠️ Conflit offline ignoré (déjà synchronisé)', entry.table, err)
        continue
      }
      console.error('Erreur de sync offline', err)
      failed.push(entry)
    }
  }
  if (failed.length > 0) {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(failed))
    console.warn('⚠️ Certaines actions hors ligne n\'ont pas pu être synchronisées. Elles resteront dans la file d\'attente.')
  } else {
    localStorage.removeItem(OFFLINE_KEY)
    console.log('✅ Synchronisation offline terminée')
  }
}

// Hook universel pour utiliser Supabase avec fallback
export function useSupabaseWithFallback(table: string) {
  return {
    async select() {
      if (isSupabaseConfigured() && supabase) {
        const { data, error } = await supabase.from(table).select('*')
        if (error) throw error
        return data
      } else {
        return getOffline().filter(e => e.table === table && e.action === 'insert').map(e => e.payload)
      }
    },
    async insert(payload: any) {
      if (isSupabaseConfigured() && supabase) {
        const { error } = await supabase.from(table).insert(payload)
        if (error) throw error
      } else {
        saveOffline({ table, action: 'insert', payload, timestamp: Date.now() })
      }
    },
    async update(id: string, data: any) {
      if (isSupabaseConfigured() && supabase) {
        const { error } = await supabase.from(table).update(data).eq('id', id)
        if (error) throw error
      } else {
        saveOffline({ table, action: 'update', payload: { id, data }, timestamp: Date.now() })
      }
    },
    async delete(id: string) {
      if (isSupabaseConfigured() && supabase) {
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (error) throw error
      } else {
        saveOffline({ table, action: 'delete', payload: { id }, timestamp: Date.now() })
      }
    },
  }
}

// Synchronisation automatique à chaque reconnexion
window.addEventListener('online', () => {
  syncOffline()
})
