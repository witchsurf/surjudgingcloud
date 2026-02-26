import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { AppConfig, InterferenceCall, InterferenceType, Score } from '../types';
import type { ParsedParticipant } from '../utils/csv';
import type { RoundSpec, HeatSlotSpec } from '../utils/bracket';
import { getColorSet } from '../utils/colorUtils';
import type { HeatColor } from '../utils/colorUtils';
import { ensureHeatId } from '../utils/heat';

export interface EventSummary {
  id: number;
  name: string;
  organizer?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  categories?: unknown;
  judges?: unknown;
  config?: unknown | null;
}

export interface ParticipantRecord extends ParsedParticipant {
  id: number;
  event_id: number;
}

const ensureSupabase = () => {
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Supabase n\'est pas configuré.');
  }
};

export interface HeatRow {
  id: string;
  event_id: number;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  heat_size: number;
  status: string;
  color_order: string[];
}

export interface HeatEntryRow {
  heat_id: string;
  participant_id: number;
  position: number;
  seed: number | null;
  color: string | null;
}

interface HeatSlotMappingRow {
  heat_id: string;
  position: number;
  placeholder: string | null;
  source_round: number | null;
  source_heat: number | null;
  source_position: number | null;
}

/**
 * Fetch the active heat pointer - used by kiosk mode to know which heat is currently active
 */
export interface ActiveHeatPointer {
  event_name: string;
  active_heat_id: string;
  updated_at: string;
}

export async function fetchActiveHeatPointer(): Promise<ActiveHeatPointer | null> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('active_heat_pointer')
    .select('*')
    .limit(1);

  if (error) {
    console.warn('⚠️ fetchActiveHeatPointer error:', error);
    return null;
  }
  return data && data.length > 0 ? (data[0] as ActiveHeatPointer) : null;
}

/**
 * Parse active_heat_id into components (event_division_rX_hX format)
 */
export function parseActiveHeatId(heatId: string): { competition: string; division: string; round: number; heatNumber: number } | null {
  // Format: laraise_pro_cadet_r1_h1
  const match = heatId.match(/^(.+)_([^_]+)_r(\d+)_h(\d+)$/i);
  if (!match) return null;

  // The competition is everything before the last 3 parts (_division_rX_hX)
  const fullName = match[1];
  const division = match[2];
  const round = parseInt(match[3], 10);
  const heatNumber = parseInt(match[4], 10);

  // Convert underscore to space for competition name
  const competition = fullName.replace(/_/g, ' ').toUpperCase();

  return { competition, division: division.toUpperCase(), round, heatNumber };
}

export async function fetchEvents(): Promise<EventSummary[]> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('events')
    .select('id, name, organizer, start_date, end_date, categories, judges, config')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as EventSummary[];
}

export interface EventConfigRecord {
  id: number;
  name: string;
  categories: string[];
  judges: Array<{ id: string; name?: string }>;
  config: Partial<AppConfig> | null;
}

export interface EventConfigSnapshot {
  event_id: number;
  event_name: string;
  division: string;
  round: number;
  heat_number: number;
  judges: Array<{ id: string; name?: string }>;
  surfers?: string[]; // Added: actual surfer colors from heat structure
  heat_size?: number; // Added: heat size from database
  surferNames?: Record<string, string>; // Added: participant names by color
  surferCountries?: Record<string, string>; // Added: participant countries by color
  eventDetails?: { organizer?: string; date?: string }; // Added: event details
  updated_at: string;
}

export async function fetchLatestEventConfig(): Promise<EventConfigRecord | null> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('events')
    .select('id, name, categories, judges, config')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const categoriesRaw = Array.isArray(data.categories) ? data.categories : [];
  const categories = categoriesRaw
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') {
        return value.name;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));

  const judgesRaw = Array.isArray(data.judges) ? data.judges : [];
  const judges = judgesRaw
    .map((value) => {
      if (typeof value === 'string') {
        return { id: value };
      }
      if (value && typeof value === 'object') {
        const maybeId = 'id' in value && typeof value.id === 'string' ? value.id : null;
        const maybeName = 'name' in value && typeof value.name === 'string' ? value.name : undefined;
        if (maybeId) {
          return { id: maybeId, name: maybeName };
        }
      }
      return null;
    })
    .filter((value): value is { id: string; name?: string } => value !== null);

  const config = data.config && typeof data.config === 'object' ? (data.config as Partial<AppConfig>) : null;

  return {
    id: data.id,
    name: data.name,
    categories,
    judges,
    config,
  };
}

export async function updateEventConfiguration(eventId: number, payload: {
  config: AppConfig;
  divisions: string[];
  judges: Array<{ id: string; name?: string }>;
}): Promise<void> {
  ensureSupabase();
  const { config, divisions, judges } = payload;

  const storedConfig: Partial<AppConfig> = {
    ...config,
    judgeNames: config.judgeNames,
  };

  const { error } = await supabase!
    .from('events')
    .update({
      name: config.competition,
      categories: divisions,
      judges,
      config: storedConfig,
    })
    .eq('id', eventId);

  if (error) throw error;
}

export async function fetchDistinctDivisions(eventId?: number): Promise<string[]> {
  ensureSupabase();

  let builder = supabase!
    .from('v_event_divisions')
    .select('division')
    .order('division', { ascending: true });

  if (eventId) {
    builder = builder.eq('event_id', eventId);
  }

  const { data, error } = await builder;

  if (error) throw error;

  const divisions = (data ?? [])
    .map((row: { division: string | null }) => row.division ?? '')
    .filter((value): value is string => Boolean(value));

  if (divisions.length > 0 || !eventId) {
    return divisions;
  }

  const fallback = await supabase!
    .from('participants')
    .select('division')
    .eq('event_id', eventId)
    .order('division', { ascending: true });

  if (fallback.error) throw fallback.error;

  return Array.from(
    new Set(
      (fallback.data ?? [])
        .map((row: { division: string | null }) => row.division ?? '')
        .filter((value): value is string => Boolean(value))
    )
  );
}

export async function fetchEventConfigSnapshot(eventId: number): Promise<EventConfigSnapshot | null> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('event_last_config')
    .select('event_id, event_name, division, round, heat_number, judges, updated_at')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const judgesPayload = Array.isArray(data.judges)
    ? (data.judges as Array<{ id?: string; name?: string }>)
      .map((judge) => {
        if (typeof judge === 'string') {
          return { id: judge, name: judge };
        }
        if (judge && typeof judge === 'object' && typeof judge.id === 'string') {
          return { id: judge.id, name: judge.name ?? judge.id };
        }
        return null;
      })
      .filter((value): value is { id: string; name: string } => Boolean(value))
    : [];

  // Fetch the current heat structure to get correct surfer count
  let surfers: string[] | undefined;
  let heatSize: number | undefined;
  let surferNames: Record<string, string> | undefined;
  let surferCountries: Record<string, string> | undefined;

  try {
    const { data: heatData } = await supabase!
      .from('heats')
      .select('id, heat_size, heat_entries(position, color, seed, participant:participants(name, country))')
      .eq('event_id', eventId)
      .eq('division', data.division)
      .eq('round', data.round)
      .eq('heat_number', data.heat_number)
      .maybeSingle();

    if (heatData) {
      heatSize = heatData.heat_size ?? undefined;

      // Build surfers list from actual heat entries, sorted by position
      const entries = (heatData.heat_entries as any[] | null) || [];
      if (entries.length > 0) {
        const sortedEntries = entries
          .filter((entry: any) => entry.color)
          .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

        surfers = Array.from(new Set(sortedEntries.map((entry: any) => {
          const color = entry.color?.toString().toUpperCase();
          return color || '';
        }).filter(Boolean)));

        // Extract participant names and countries by color
        surferNames = {};
        surferCountries = {};
        sortedEntries.forEach((entry: any) => {
          const color = entry.color?.toString().toUpperCase();
          if (color && entry.participant) {
            if (entry.participant.name) {
              surferNames![color] = entry.participant.name;
            }
            if (entry.participant.country) {
              surferCountries![color] = entry.participant.country;
            }
          }
        });

        console.log(`✅ Config loaded: ${surfers.length} surfers with names for ${data.division} R${data.round}H${data.heat_number}`);
      }
    }
  } catch (err) {
    console.warn('Could not fetch heat structure, will use defaults:', err);
  }

  // Fetch event details (organizer, date)
  let eventDetails: { organizer?: string; date?: string } | undefined;
  try {
    const { data: eventData } = await supabase!
      .from('events')
      .select('organizer, start_date')
      .eq('id', eventId)
      .maybeSingle();

    if (eventData) {
      eventDetails = {
        organizer: eventData.organizer,
        date: eventData.start_date ? new Date(eventData.start_date).toLocaleDateString('fr-FR') : undefined,
      };
    }
  } catch (err) {
    console.warn('Could not fetch event details:', err);
  }

  return {
    event_id: data.event_id,
    event_name: data.event_name,
    division: data.division,
    round: data.round,
    heat_number: data.heat_number,
    judges: judgesPayload,
    surfers, // Include surfers if available
    heat_size: heatSize,
    surferNames, // Include participant names
    surferCountries, // Include participant countries
    eventDetails, // Include event details
    updated_at: data.updated_at,
  };
}

export async function saveEventConfigSnapshot(payload: {
  eventId: number;
  eventName: string;
  division: string;
  round: number;
  heatNumber: number;
  judges: Array<{ id: string; name?: string }>;
}): Promise<void> {
  ensureSupabase();

  const judgePayload = payload.judges.map((judge) => ({
    id: judge.id,
    name: judge.name ?? judge.id,
  }));

  const { error } = await supabase!.rpc('upsert_event_last_config', {
    p_event_id: payload.eventId,
    p_event_name: payload.eventName,
    p_division: payload.division,
    p_round: payload.round,
    p_heat_number: payload.heatNumber,
    p_judges: judgePayload,
  });

  if (error) throw error;
}

export async function fetchParticipants(eventId: number): Promise<ParticipantRecord[]> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('participants')
    .select('id, event_id, category, seed, name, country, license')
    .eq('event_id', eventId)
    .order('category', { ascending: true })
    .order('seed', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ParticipantRecord[];
}

export async function upsertParticipants(eventId: number, rows: ParsedParticipant[]) {
  ensureSupabase();
  if (!rows.length) return;

  const payload = rows.map((row) => ({
    event_id: eventId,
    category: row.category,
    seed: row.seed,
    name: row.name,
    country: row.country ?? null,
    license: row.license ?? null,
  }));

  const { error } = await supabase!
    .from('participants')
    .upsert(payload, { onConflict: 'event_id,category,seed' });

  if (error) throw error;
}

export async function updateParticipant(id: number, patch: Partial<ParsedParticipant>) {
  ensureSupabase();
  const { error } = await supabase!
    .from('participants')
    .update({
      name: patch.name,
      country: patch.country,
      license: patch.license,
      seed: patch.seed,
      category: patch.category,
    })
    .eq('id', id);

  if (error) throw error;
}

export async function deleteParticipant(id: number) {
  ensureSupabase();
  const { error } = await supabase!.from('participants').delete().eq('id', id);
  if (error) throw error;
}

export async function deletePlannedHeats(eventId: number, category: string) {
  ensureSupabase();
  const { data: planned, error } = await supabase!
    .from('heats')
    .select('id')
    .eq('event_id', eventId)
    .eq('division', category)
    .in('status', ['planned', 'open']);

  if (error) throw error;
  if (!planned || planned.length === 0) return;

  const heatIds = planned.map((row) => row.id);
  await supabase!.from('heat_entries').delete().in('heat_id', heatIds);
  const { error: deleteHeatsError } = await supabase!.from('heats').delete().in('id', heatIds);
  if (deleteHeatsError) throw deleteHeatsError;
}

interface CreateHeatsOptions {
  overwrite?: boolean;
  repechage?: RoundSpec[];
}

export async function createHeatsWithEntries(
  eventId: number,
  eventName: string,
  category: string,
  rounds: RoundSpec[],
  participantsBySeed: Map<number, ParticipantRecord>,
  options: CreateHeatsOptions = {}
): Promise<{ heats: HeatRow[]; entries: HeatEntryRow[] }> {
  ensureSupabase();
  const heatRows: HeatRow[] = [];
  const entryRows: HeatEntryRow[] = [];
  const slotMappings: HeatSlotMappingRow[] = [];
  const newHeatIds: string[] = [];
  const trimmedEventName = eventName.trim();
  const trimmedCategory = category.trim();

  const participantsByName = new Map<string, ParticipantRecord>();
  participantsBySeed.forEach((participant) => {
    participantsByName.set(participant.name.trim().toLowerCase(), participant);
  });

  const missingParticipants: Array<{ seed: number | null; name?: string }> = [];

  const parsePlaceholder = (value?: string | null) => {
    if (!value) {
      return { placeholder: null, sourceRound: null, sourceHeat: null, sourcePosition: null };
    }

    const normalized = value.trim().toUpperCase();
    // Accept multiple formats:
    // - R1-H2-P1
    // - R1-H2 P1
    // - R1-H2 (P1)
    // - QUALIFIE R1-H2 (P1)
    const canonical = normalized.match(/R(P?)(\d+)-H(\d+)-P(\d+)/);
    if (canonical) {
      const [, , roundStr, heatStr, posStr] = canonical;
      return {
        placeholder: normalized,
        sourceRound: Number.parseInt(roundStr, 10),
        sourceHeat: Number.parseInt(heatStr, 10),
        sourcePosition: Number.parseInt(posStr, 10),
      };
    }

    const spaced = normalized.match(/R(P?)(\d+)\s*-\s*H(\d+)\s*(?:\(\s*P(\d+)\s*\)|\s+P(\d+))/);
    if (spaced) {
      const [, , roundStr, heatStr, posA, posB] = spaced;
      const posStr = posA ?? posB;
      return {
        placeholder: normalized,
        sourceRound: Number.parseInt(roundStr, 10),
        sourceHeat: Number.parseInt(heatStr, 10),
        sourcePosition: Number.parseInt(posStr, 10),
      };
    }

    return { placeholder: normalized, sourceRound: null, sourceHeat: null, sourcePosition: null };
  };

  // 1. Pre-upsert participants to ensure we have their IDs
  const participantsPayload = Array.from(participantsBySeed.values()).map((participant) => ({
    event_id: eventId,
    category: category,
    seed: participant.seed,
    name: participant.name,
    country: participant.country ?? null,
    license: participant.license ?? null,
  }));

  if (participantsPayload.length > 0) {
    const { error: upsertError } = await supabase!
      .from('participants')
      .upsert(participantsPayload, { onConflict: 'event_id,category,seed' });

    if (upsertError) {
      console.error('Error upserting participants:', upsertError);
      throw new Error(`Erreur lors de la sauvegarde des participants: ${upsertError.message}`);
    }
  }

  // 2. Re-fetch participants to get their confirmed IDs
  const { data: refreshedParticipants, error: refreshError } = await supabase!
    .from('participants')
    .select('id, seed')
    .eq('event_id', eventId)
    .eq('category', category);

  if (refreshError) {
    throw new Error(`Erreur lors de la récupération des IDs participants: ${refreshError.message}`);
  }

  const participantMap: Record<number, { id: number }> = Object.fromEntries(
    (refreshedParticipants ?? [])
      .filter((p): p is { id: number; seed: number } => typeof p.seed === 'number')
      .map((p) => [p.seed, { id: p.id as number }])
  );

  rounds.forEach((round) => {
    round.heats.forEach((heat) => {
      const heatId = `${trimmedEventName}_${trimmedCategory}_R${round.roundNumber}_H${heat.heatNumber}`
        .toLowerCase()
        .replace(/\s+/g, '_');
      const colorOrder = getColorSet(heat.slots.length);
      // Persist the jersey order so the judge interface and exports stay aligned.
      heatRows.push({
        id: heatId,
        event_id: eventId,
        competition: eventName,
        division: category,
        round: round.roundNumber,
        heat_number: heat.heatNumber,
        heat_size: heat.slots.length,
        status: 'open',
        color_order: colorOrder,
      });
      newHeatIds.push(heatId);

      heat.slots.forEach((slot, index) => {
        const { placeholder, sourceRound, sourceHeat, sourcePosition } = parsePlaceholder(slot.placeholder);
        slotMappings.push({
          heat_id: heatId,
          position: index + 1,
          placeholder,
          source_round: sourceRound,
          source_heat: sourceHeat,
          source_position: sourcePosition,
        });

        const slotColor = colorOrder[index] ?? null;
        const seed = slot.seed ?? null;

        // Always create an entry row for placeholders so future rounds are fully hydrated
        // and can be updated later via qualifier propagation.
        if (slot.placeholder) {
          console.log(`  Slot ${index + 1}: Placeholder "${slot.placeholder}" - creating empty entry`);
          entryRows.push({
            heat_id: heatId,
            participant_id: null,
            position: index + 1,
            seed: seed ?? index + 1,
            color: slotColor,
          });
          return;
        }

        let participant: ParticipantRecord | undefined;
        if (seed != null) {
          participant = participantsBySeed.get(seed);
          console.log(`  Slot ${index + 1}: Looking up seed ${seed} - ${participant ? 'FOUND' : 'NOT FOUND'}`);
        }
        if (!participant && slot.name) {
          participant = participantsByName.get(slot.name.trim().toLowerCase());
          console.log(`  Slot ${index + 1}: Looking up name "${slot.name}" - ${participant ? 'FOUND' : 'NOT FOUND'}`);
        }

        if (!participant) {
          console.warn(`  Slot ${index + 1}: No participant found for seed=${seed}, name="${slot.name}"`);
          missingParticipants.push({ seed, name: slot.name });
          return;
        }

        const participantFromDb = seed != null ? participantMap[seed] : undefined;

        console.log(`  Slot ${index + 1}: Creating entry for ${participant.name} (seed ${seed})`);

        entryRows.push({
          heat_id: heatId,
          participant_id: participantFromDb?.id ?? participant.id,
          position: index + 1,
          seed: seed ?? 0, // Database requires non-null seed, use 0 as default for participants without explicit seeds
          color: slotColor,
        });
      });
    });
  });

  if (missingParticipants.length) {
    const missingList = missingParticipants
      .map((entry) => (entry.seed != null ? `seed ${entry.seed}` : entry.name ?? 'inconnu'))
      .join(', ');
    throw new Error(`Participants manquants pour l’événement. Vérifiez les seeds: ${missingList}`);
  }

  if (heatRows.length === 0) {
    throw new Error('Aucun heat généré.');
  }



  let deleteHeatIds: string[] = [];
  if (options.overwrite) {
    const { data: existing, error: existingError } = await supabase!
      .from('heats')
      .select('id')
      .eq('event_id', eventId)
      .eq('division', category);

    if (existingError) throw existingError;
    if (existing?.length) {
      deleteHeatIds = existing.map((row) => row.id);
    }
  }

  console.log("➡️ Preparing heats with entries", {
    heatCount: heatRows.length,
    entryCount: entryRows.length,
    mappingCount: slotMappings.length,
    participantMapSize: participantsBySeed.size
  });

  if (entryRows.length === 0) {
    console.warn("⚠️ No heat entries created! This might indicate participants weren't found in the lookup maps.");
  }

  const { error: rpcError } = await supabase!.rpc('bulk_upsert_heats', {
    p_heats: heatRows,
    p_entries: entryRows,
    p_mappings: slotMappings,
    p_participants: participantsPayload,
    p_delete_ids: options.overwrite ? deleteHeatIds : newHeatIds,
  } as {
    p_heats: any;
    p_entries: any;
    p_mappings: any;
    p_participants: any;
    p_delete_ids: string[];
  });
  console.log("✅ bulk_upsert_heats result", { rpcError });

  if (rpcError) throw rpcError;

  return {
    heats: heatRows,
    entries: entryRows,
  };
}

interface SupabaseHeatEntry {
  position: number;
  seed: number;
  color: string | null;
  participant_id: number | null;
  participant: {
    id: number;
    name: string;
    country: string | null;
    license: string | null;
  } | null;
}
interface HeatEntriesWithParticipantRow {
  color: string | null;
  position: number;
  participant_id: number | null;
  seed: number | null;
  participant: {
    name: string;
    country: string | null;
    license: string | null;
  } | null;
}

interface SupabaseHeatRow {
  id: string;
  round: number;
  heat_number: number;
  heat_size: number | null;
  color_order: string[] | null;
  heat_entries: SupabaseHeatEntry[];
  heat_slot_mappings: HeatSlotMappingRow[] | null;
}

const prettyRoundName = (roundNumber: number, maxRound: number): string => {
  if (roundNumber === maxRound && maxRound > 1) return 'Finale';
  return `Round ${roundNumber}`;
};

export async function fetchCategoryHeats(eventId: number, category: string): Promise<RoundSpec[]> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('heats')
    .select(`id, round, heat_number, heat_size, color_order, heat_entries ( position, seed, color, participant:participants ( id, name, country, license ) ), heat_slot_mappings ( position, placeholder, source_round, source_heat, source_position )`)
    .eq('event_id', eventId)
    .eq('division', category)
    .order('round', { ascending: true })
    .order('heat_number', { ascending: true })
    .order('position', { ascending: true, foreignTable: 'heat_entries' });

  if (error) throw error;
  const heats = (data ?? []) as unknown as SupabaseHeatRow[];
  if (!heats.length) return [];

  const maxRound = Math.max(...heats.map((heat) => heat.round));
  const roundsMap = new Map<number, RoundSpec>();

  heats.forEach((heat) => {
    if (!roundsMap.has(heat.round)) {
      roundsMap.set(heat.round, {
        name: prettyRoundName(heat.round, maxRound),
        roundNumber: heat.round,
        heats: [],
      });
    }
    const round = roundsMap.get(heat.round)!;
    const fallbackOrder = getColorSet(heat.heat_size ?? heat.heat_entries.length);
    const allowedColors: HeatColor[] = ['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK'];
    const colorOrder = fallbackOrder.map((defaultColor, idx) => {
      const candidate = heat.color_order?.[idx];
      if (!candidate) return defaultColor;
      const upper = candidate.toUpperCase() as HeatColor;
      return allowedColors.includes(upper) ? upper : defaultColor;
    });
    // Rebuild each heat slot so the preview mirrors the judge interface.
    const slots: HeatSlotSpec[] = colorOrder.map((color, idx) => {
      const entry = heat.heat_entries.find((row) => row.position === idx + 1);
      const mapping = heat.heat_slot_mappings?.find((row) => row.position === idx + 1);
      if (entry && entry.participant) {
        const entryColor = entry.color ? (entry.color.toUpperCase() as HeatColor) : undefined;
        const resolvedColor = entryColor && allowedColors.includes(entryColor) ? entryColor : color;
        return {
          seed: entry.seed,
          name: entry.participant.name,
          country: entry.participant.country ?? undefined,
          license: entry.participant.license ?? undefined,
          participantId: entry.participant_id ?? entry.participant.id,
          color: resolvedColor,
        };
      }
      const placeholderValue = mapping?.placeholder ? mapping.placeholder.toUpperCase() : null;
      const isByePlaceholder = !placeholderValue || placeholderValue === 'BYE';
      return {
        placeholder: placeholderValue ?? 'BYE',
        bye: isByePlaceholder,
        color,
      };
    });

    round.heats.push({
      heatNumber: heat.heat_number,
      slots,
      roundRef: `${round.name}-H${heat.heat_number}`,
      heatId: heat.id,
    });
  });

  return Array.from(roundsMap.values()).sort((a, b) => a.roundNumber - b.roundNumber);
}

/**
 * Fetch all distinct divisions/categories for an event
 */
export async function fetchAllEventCategories(eventId: number): Promise<string[]> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('heats')
    .select('division')
    .eq('event_id', eventId);

  if (error) throw error;
  const divisions = [...new Set((data ?? []).map((h) => h.division))];
  return divisions.sort();
}

/**
 * Fetch all heats for all categories in an event
 * Returns a map of category -> RoundSpec[]
 */
export async function fetchAllEventHeats(eventId: number): Promise<Record<string, RoundSpec[]>> {
  const categories = await fetchAllEventCategories(eventId);
  const result: Record<string, RoundSpec[]> = {};

  for (const category of categories) {
    result[category] = await fetchCategoryHeats(eventId, category);
  }

  return result;
}

/**
 * Fetch all scores for all heats of an event
 * Returns a map of heatId -> Score[]
 */
export async function fetchAllScoresForEvent(eventId: number): Promise<Record<string, Score[]>> {
  ensureSupabase();

  // First get all heat IDs for this event
  const { data: heats, error: heatsError } = await supabase!
    .from('heats')
    .select('id')
    .eq('event_id', eventId);

  if (heatsError) throw heatsError;
  const heatIds = (heats ?? []).map((h) => h.id);

  if (!heatIds.length) return {};

  // Fetch all scores for these heats
  const { data: scores, error: scoresError } = await supabase!
    .from('scores')
    .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
    .in('heat_id', heatIds)
    .order('created_at', { ascending: true });

  if (scoresError) throw scoresError;

  // Group scores by heat_id
  const result: Record<string, Score[]> = {};
  ((scores ?? []) as RawScoreRow[]).forEach((row) => {
    const parsed = toParsedScore(row);
    const key = parsed.heat_id;
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(parsed);
  });

  Object.keys(result).forEach((heatId) => {
    result[heatId] = canonicalizeScores(result[heatId]);
  });

  return result;
}

/**
 * Fetch all interference calls for all heats of an event
 * Returns a map of heatId -> InterferenceCall[]
 */
export async function fetchAllInterferenceCallsForEvent(eventId: number): Promise<Record<string, InterferenceCall[]>> {
  ensureSupabase();

  const { data: heats, error: heatsError } = await supabase!
    .from('heats')
    .select('id')
    .eq('event_id', eventId);

  if (heatsError) throw heatsError;
  const heatIds = (heats ?? []).map((h) => h.id);

  if (!heatIds.length) return {};

  const { data: calls, error: callsError } = await supabase!
    .from('interference_calls')
    .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
    .in('heat_id', heatIds);

  if (callsError) throw callsError;

  const result: Record<string, InterferenceCall[]> = {};
  (calls ?? []).forEach((call) => {
    const key = ensureHeatId((call as InterferenceCall).heat_id);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(call as InterferenceCall);
  });

  return result;
}

export function subscribeToHeatUpdates(eventId: number, category: string, callback: () => void) {
  ensureSupabase();
  const heatPrefix = `event_${eventId}_${category.replace(/\s+/g, '_')}_`;
  const channel = supabase!
    .channel(`heats-${eventId}-${category}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'heat_entries' }, (payload) => {
      const heatId = (payload.new as { heat_id?: string } | null)?.heat_id;
      if (heatId && heatId.startsWith(heatPrefix)) {
        callback();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `event_id=eq.${eventId}` }, callback)
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

export async function fetchHeatEntriesWithParticipants(heatId: string) {
  ensureSupabase();
  const normalizedHeatId = ensureHeatId(heatId);

  const { data, error } = await supabase!
    .from('heat_entries')
    .select('color, position, participant_id, seed, participant:participants(name, country, license)')
    .eq('heat_id', normalizedHeatId)
    .order('position', { ascending: true });

  if (error) {
    console.error('❌ Error fetching heat_entries with participants:', error);
    throw error;
  }

  const rows = (data ?? []) as unknown as Array<{
    color: string | null;
    position: number;
    participant_id: number | null;
    seed: number | null;
    participant: { name: string; country: string | null; license: string | null } | null;
  }>;
  const typedRows: HeatEntriesWithParticipantRow[] = rows.map((row) => ({
    color: row.color,
    position: row.position,
    participant_id: row.participant_id,
    seed: row.seed,
    participant: row.participant
      ? {
        name: row.participant.name,
        country: row.participant.country,
        license: row.participant.license,
      }
      : null,
  }));
  const hasNamedParticipant = rows.some((row) => row.participant?.name);

  if (rows.length > 0 && hasNamedParticipant) {
    return typedRows;
  }

  const { data: lineup, error: lineupError } = await supabase!
    .from('v_heat_lineup')
    .select('jersey_color, position, surfer_name, country, seed')
    .eq('heat_id', normalizedHeatId)
    .order('position', { ascending: true });

  if (lineupError) {
    // Some deployments may not have v_heat_lineup (or permissions on it).
    // Do not crash participant loading: fallback to heat_entries rows.
    console.warn('⚠️ v_heat_lineup unavailable, fallback to heat_entries only:', lineupError);
    return typedRows;
  }

  const fallbackEntries = (lineup ?? []).map((row: { jersey_color: string | null; position: number; surfer_name: string | null; country: string | null; seed: number | null }) => ({
    color: row.jersey_color ?? null,
    position: row.position,
    participant_id: null,
    seed: row.seed ?? null,
    participant: row.surfer_name
      ? {
        name: row.surfer_name,
        country: row.country ?? null,
        license: null,
      }
      : null,
  }));

  if (fallbackEntries.length === 0 && rows.length > 0) {
    return typedRows;
  }

  return fallbackEntries as unknown as HeatEntriesWithParticipantRow[];
}

export async function fetchHeatSlotMappings(heatId: string) {
  ensureSupabase();
  const normalizedHeatId = ensureHeatId(heatId);
  const { data, error } = await supabase!
    .from('heat_slot_mappings')
    .select('position, placeholder, source_round, source_heat, source_position')
    .eq('heat_id', normalizedHeatId)
    .order('position', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchHeatMetadata(heatId: string): Promise<HeatRow | null> {
  ensureSupabase();
  const normalizedHeatId = ensureHeatId(heatId);
  const { data, error } = await supabase!
    .from('heats')
    .select('id, event_id, competition, division, round, heat_number, heat_size, status, color_order')
    .eq('id', normalizedHeatId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return (data as HeatRow) ?? null;
}

export async function replaceHeatEntries(heatId: string, rows: { position: number; participant_id: number | null; seed?: number | null; color?: string | null }[]) {
  ensureSupabase();
  const normalizedHeatId = ensureHeatId(heatId);
  if (!rows.length) return;

  const positions = rows.map((row) => row.position);

  await supabase!
    .from('heat_entries')
    .delete()
    .eq('heat_id', normalizedHeatId)
    .in('position', positions);

  const payload = rows.map((row) => ({
    heat_id: normalizedHeatId,
    participant_id: row.participant_id,
    position: row.position,
    seed: row.seed ?? null,
    color: row.color ?? null,
  }));

  const { error } = await supabase!
    .from('heat_entries')
    .insert(payload);

  if (error) throw error;
}

interface HeatSequenceRow {
  id: string;
  round: number;
  heat_number: number;
  status: string;
  heat_size: number | null;
  color_order: string[] | null;
}

type RawScoreRow = {
  id?: string;
  event_id?: number;
  heat_id: string;
  competition: string;
  division: string;
  round: number;
  judge_id: string;
  judge_name: string;
  surfer: string;
  wave_number: number;
  score: number;
  timestamp?: string;
  created_at?: string;
};

const normalizeScoreJudgeId = (judgeId?: string) => {
  const upper = (judgeId || '').trim().toUpperCase();
  if (upper === 'KIOSK-J1') return 'J1';
  if (upper === 'KIOSK-J2') return 'J2';
  if (upper === 'KIOSK-J3') return 'J3';
  return upper || judgeId || '';
};

const SCORE_SURFER_MAP: Record<string, string> = {
  RED: 'RED',
  ROUGE: 'RED',
  WHITE: 'WHITE',
  BLANC: 'WHITE',
  YELLOW: 'YELLOW',
  JAUNE: 'YELLOW',
  BLUE: 'BLUE',
  BLEU: 'BLUE',
  GREEN: 'GREEN',
  VERT: 'GREEN',
  BLACK: 'BLACK',
  NOIR: 'BLACK',
};

const normalizeScoreSurfer = (surfer?: string) => {
  const upper = (surfer || '').trim().toUpperCase();
  return SCORE_SURFER_MAP[upper] || upper || surfer || '';
};

const scoreTimestampMs = (score: Score) =>
  new Date(score.created_at || score.timestamp || 0).getTime();

const toParsedScore = (row: RawScoreRow): Score => ({
  id: row.id,
  event_id: row.event_id,
  heat_id: ensureHeatId(row.heat_id),
  competition: row.competition,
  division: row.division,
  round: row.round,
  judge_id: normalizeScoreJudgeId(row.judge_id),
  judge_name: normalizeScoreJudgeId(row.judge_name),
  surfer: normalizeScoreSurfer(row.surfer),
  wave_number: row.wave_number,
  score: typeof row.score === 'number' ? row.score : Number(row.score) || 0,
  timestamp: row.timestamp ?? new Date().toISOString(),
  created_at: row.created_at ?? undefined,
  synced: true,
});

const canonicalizeScores = (scores: Score[]): Score[] => {
  const latestByLogicalKey = new Map<string, Score>();
  scores.forEach((score) => {
    const key = `${score.heat_id}::${normalizeScoreJudgeId(score.judge_id)}::${normalizeScoreSurfer(score.surfer)}::${Number(score.wave_number)}`;
    const existing = latestByLogicalKey.get(key);
    if (!existing || scoreTimestampMs(score) >= scoreTimestampMs(existing)) {
      latestByLogicalKey.set(key, score);
    }
  });
  return Array.from(latestByLogicalKey.values())
    .sort((a, b) => scoreTimestampMs(a) - scoreTimestampMs(b));
};

export async function fetchOrderedHeatSequence(eventId: number, category: string): Promise<HeatSequenceRow[]> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('heats')
    .select('id, round, heat_number, status, heat_size, color_order')
    .eq('event_id', eventId)
    .eq('division', category)
    .order('round', { ascending: true })
    .order('heat_number', { ascending: true });

  if (error) throw error;
  return (data ?? []) as HeatSequenceRow[];
}

export async function fetchHeatScores(heatId: string): Promise<Score[]> {
  ensureSupabase();
  const normalizedHeatId = ensureHeatId(heatId);
  const { data, error } = await supabase!
    .from('scores')
    .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
    .eq('heat_id', normalizedHeatId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as RawScoreRow[];
  return canonicalizeScores(rows.map(toParsedScore));
}

export async function fetchInterferenceCalls(heatId: string): Promise<InterferenceCall[]> {
  ensureSupabase();
  const normalizedHeatId = ensureHeatId(heatId);
  const { data, error } = await supabase!
    .from('interference_calls')
    .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
    .eq('heat_id', normalizedHeatId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as InterferenceCall[];
}

export async function upsertInterferenceCall(input: {
  event_id?: number | null;
  heat_id: string;
  competition?: string;
  division?: string;
  round?: number;
  judge_id: string;
  judge_name?: string;
  surfer: string;
  wave_number: number;
  call_type: InterferenceType;
  is_head_judge_override?: boolean;
}): Promise<void> {
  ensureSupabase();
  const payload = {
    event_id: input.event_id ?? null,
    heat_id: ensureHeatId(input.heat_id),
    competition: input.competition ?? null,
    division: input.division ?? null,
    round: input.round ?? null,
    judge_id: input.judge_id,
    judge_name: input.judge_name ?? null,
    surfer: input.surfer,
    wave_number: input.wave_number,
    call_type: input.call_type,
    is_head_judge_override: Boolean(input.is_head_judge_override),
  };

  const { error } = await supabase!
    .from('interference_calls')
    .upsert(payload, { onConflict: 'heat_id,judge_id,surfer,wave_number' });
  if (error) throw error;
}

export async function fetchScoresForHeats(heatIds: string[]): Promise<Record<string, Score[]>> {
  ensureSupabase();
  if (!heatIds.length) {
    return {};
  }

  const normalizedIds = Array.from(new Set(heatIds.map((id) => ensureHeatId(id))));
  const { data, error } = await supabase!
    .from('scores')
    .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
    .in('heat_id', normalizedIds)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as RawScoreRow[];

  const grouped: Record<string, Score[]> = {};
  rows.forEach((row) => {
    const parsed = toParsedScore(row);
    if (!grouped[parsed.heat_id]) {
      grouped[parsed.heat_id] = [];
    }
    grouped[parsed.heat_id].push(parsed);
  });

  Object.keys(grouped).forEach((heatId) => {
    grouped[heatId] = canonicalizeScores(grouped[heatId]);
  });

  return grouped;
}

/**
 * Ensure an event exists in the database, creating it if necessary
 * @returns The event ID
 */
export async function ensureEventExists(eventName: string): Promise<number> {
  ensureSupabase();

  // Try to find existing event
  const { data: existing, error: fetchError } = await supabase!
    .from('events')
    .select('id')
    .eq('name', eventName)
    .maybeSingle();

  if (fetchError && fetchError.code !== 'PGRST116') {
    throw fetchError;
  }

  if (existing) {
    console.log(`✅ Event "${eventName}" already exists (ID: ${existing.id})`);
    return existing.id;
  }

  // Event doesn't exist, create it with only existing columns
  const { data: newEvent, error: createError } = await supabase!
    .from('events')
    .insert({
      name: eventName,
      organizer: 'Auto-created',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      price: 0
    })
    .select('id')
    .single();

  if (createError) {
    console.error('❌ Error creating event:', createError);
    throw createError;
  }

  console.log(`🎉 Event "${eventName}" created (ID: ${newEvent.id})`);
  return newEvent.id;
}

export async function fetchEventIdByName(name: string): Promise<number | null> {
  ensureSupabase();
  const { data, error } = await supabase!
    .from('events')
    .select('id')
    .eq('name', name)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('Error fetching event ID by name:', error);
    return null;
  }
  return data?.id || null;
}

export async function updateJudgeName(eventId: number, judgeId: string, name: string): Promise<void> {
  ensureSupabase();

  // First get current judges
  const { data: event, error: fetchError } = await supabase!
    .from('events')
    .select('judges')
    .eq('id', eventId)
    .single();

  if (fetchError) throw fetchError;

  let judges = event.judges as any[];
  if (!Array.isArray(judges)) judges = [];

  // Update or add judge
  const existingIndex = judges.findIndex((j: any) =>
    (typeof j === 'string' && j === judgeId) ||
    (typeof j === 'object' && j.id === judgeId)
  );

  if (existingIndex >= 0) {
    if (typeof judges[existingIndex] === 'string') {
      judges[existingIndex] = { id: judgeId, name };
    } else {
      judges[existingIndex] = { ...judges[existingIndex], name };
    }
  } else {
    // If judge not found in list, add it (shouldn't happen usually but good fallback)
    judges.push({ id: judgeId, name });
  }

  const { error: updateError } = await supabase!
    .from('events')
    .update({ judges })
    .eq('id', eventId);

  if (updateError) throw updateError;
}

// ============================================================================
// JUDGES API FUNCTIONS
// ============================================================================

export interface Judge {
  id: string;
  name: string;
  personal_code: string;
  email?: string | null;
  phone?: string | null;
  certification_level?: string | null;
  federation: string;
  active: boolean;
  created_at: string;
}

/**
 * Fetch all active judges from the database
 */
export async function fetchActiveJudges(): Promise<Judge[]> {
  ensureSupabase();

  const { data, error } = await supabase!
    .from('judges')
    .select('*')
    .eq('active', true)
    .order('name');

  if (error) {
    console.error('Error fetching active judges:', error);
    throw error;
  }

  return data || [];
}

/**
 * Fetch a single judge by ID
 */
export async function fetchJudgeById(judgeId: string): Promise<Judge | null> {
  ensureSupabase();

  const { data, error } = await supabase!
    .from('judges')
    .select('*')
    .eq('id', judgeId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching judge:', error);
    throw error;
  }

  return data;
}

/**
 * Validate a judge's personal code
 * Returns the judge if valid, null if invalid
 */
export async function validateJudgeCode(
  judgeId: string,
  personalCode: string
): Promise<Judge | null> {
  ensureSupabase();

  const { data, error } = await supabase!
    .from('judges')
    .select('*')
    .eq('id', judgeId)
    .eq('personal_code', personalCode)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    console.error('Error validating judge code:', error);
    return null;
  }

  return data;
}

/**
 * Create a new judge
 */
export async function createJudge(payload: {
  name: string;
  personal_code: string;
  email?: string;
  phone?: string;
  certification_level?: string;
  federation?: string;
}): Promise<Judge> {
  ensureSupabase();

  const { data, error } = await supabase!
    .from('judges')
    .insert({
      ...payload,
      federation: payload.federation || 'FSS',
      active: true
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating judge:', error);
    throw error;
  }

  return data;
}

/**
 * Update an existing judge
 */
export async function updateJudge(
  judgeId: string,
  payload: Partial<Omit<Judge, 'id' | 'created_at'>>
): Promise<Judge> {
  ensureSupabase();

  const { data, error } = await supabase!
    .from('judges')
    .update(payload)
    .eq('id', judgeId)
    .select()
    .single();

  if (error) {
    console.error('Error updating judge:', error);
    throw error;
  }

  return data;
}

/**
 * Deactivate a judge (soft delete)
 */
export async function deactivateJudge(judgeId: string): Promise<void> {
  ensureSupabase();

  const { error } = await supabase!
    .from('judges')
    .update({ active: false })
    .eq('id', judgeId);

  if (error) {
    console.error('Error deactivating judge:', error);
    throw error;
  }
}
