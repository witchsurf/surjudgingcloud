import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Créer le client Supabase seulement si les variables d'environnement sont valides
export const supabase = supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined'
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Fonction pour vérifier si Supabase est configuré
export const isSupabaseConfigured = () => {
  return !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined' && supabase);
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
              const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
              return sorted.length ? sorted[0][0] : 'OPEN';
            }
          } catch (err) {}
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
            const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
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
  action: 'insert' | 'update' | 'delete'
  payload: any
  timestamp: number
}

const OFFLINE_KEY = 'surfapp_offline_queue'

// Sauvegarder une action hors ligne
function saveOffline(entry: OfflineEntry) {
  const queue: OfflineEntry[] = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
  queue.push(entry)
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(queue))
}

// Récupérer la queue offline
function getOffline(): OfflineEntry[] {
  return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
}

// Synchroniser les actions offline dès que Supabase est dispo
export async function syncOffline() {
  if (!isSupabaseConfigured() || !supabase) return
  const queue = getOffline()
  if (queue.length === 0) return
  const failed: OfflineEntry[] = []

  for (const entry of queue) {
    try {
      if (entry.action === 'insert')
        await supabase.from(entry.table).insert(entry.payload)
      else if (entry.action === 'update')
        await supabase.from(entry.table).update(entry.payload.data).eq('id', entry.payload.id)
      else if (entry.action === 'delete')
        await supabase.from(entry.table).delete().eq('id', entry.payload.id)
    } catch (err) {
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
