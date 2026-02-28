import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api';
import { getColorSet, type HeatColor } from '../../utils/colorUtils';
import { ensureHeatId } from '../../utils/heat';
import type { RoundSpec, HeatSlotSpec } from '../../utils/bracket';
import type { ParticipantRecord } from './participants.api';

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
    participant_id: number | null;
    position: number;
    seed: number | null;
    color: string | null;
}

export interface HeatSlotMappingRow {
    heat_id: string;
    position: number;
    placeholder: string | null;
    source_round: number | null;
    source_heat: number | null;
    source_position: number | null;
}

export interface HeatSequenceRow {
    id: string;
    round: number;
    heat_number: number;
    status: string;
    heat_size: number | null;
    color_order: string[] | null;
}

export interface HeatEntriesWithParticipantRow {
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

export interface CreateHeatsOptions {
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
        if (!value) return { placeholder: null, sourceRound: null, sourceHeat: null, sourcePosition: null };
        const normalized = value.trim().toUpperCase();
        const canonical = normalized.match(/R(P?)(\d+)-H(\d+)-P(\d+)/);
        if (canonical) {
            const [, , roundStr, heatStr, posStr] = canonical;
            return { placeholder: normalized, sourceRound: Number.parseInt(roundStr, 10), sourceHeat: Number.parseInt(heatStr, 10), sourcePosition: Number.parseInt(posStr, 10) };
        }
        const spaced = normalized.match(/R(P?)(\d+)\s*-\s*H(\d+)\s*(?:\(\s*P(\d+)\s*\)|\s+P(\d+))/);
        if (spaced) {
            const [, , roundStr, heatStr, posA, posB] = spaced;
            const posStr = posA ?? posB;
            return { placeholder: normalized, sourceRound: Number.parseInt(roundStr, 10), sourceHeat: Number.parseInt(heatStr, 10), sourcePosition: Number.parseInt(posStr, 10) };
        }
        return { placeholder: normalized, sourceRound: null, sourceHeat: null, sourcePosition: null };
    };

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
        if (upsertError) throw new Error(`Erreur lors de la sauvegarde des participants: ${upsertError.message}`);
    }

    const { data: refreshedParticipants, error: refreshError } = await supabase!
        .from('participants')
        .select('id, seed')
        .eq('event_id', eventId)
        .eq('category', category);

    if (refreshError) throw new Error(`Erreur lors de la récupération des IDs participants: ${refreshError.message}`);

    const participantMap: Record<number, { id: number }> = Object.fromEntries(
        (refreshedParticipants ?? [])
            .filter((p): p is { id: number; seed: number } => typeof p.seed === 'number')
            .map((p) => [p.seed, { id: p.id as number }])
    );

    rounds.forEach((round) => {
        round.heats.forEach((heat) => {
            const heatId = `${trimmedEventName}_${trimmedCategory}_R${round.roundNumber}_H${heat.heatNumber}`.toLowerCase().replace(/\s+/g, '_');
            const colorOrder = getColorSet(heat.slots.length);

            heatRows.push({
                id: heatId, event_id: eventId, competition: eventName, division: category,
                round: round.roundNumber, heat_number: heat.heatNumber, heat_size: heat.slots.length,
                status: 'open', color_order: colorOrder,
            });
            newHeatIds.push(heatId);

            heat.slots.forEach((slot, index) => {
                const { placeholder, sourceRound, sourceHeat, sourcePosition } = parsePlaceholder(slot.placeholder);
                slotMappings.push({
                    heat_id: heatId, position: index + 1, placeholder,
                    source_round: sourceRound, source_heat: sourceHeat, source_position: sourcePosition,
                });

                const slotColor = colorOrder[index] ?? null;
                const seed = slot.seed ?? null;

                if (slot.placeholder) {
                    entryRows.push({ heat_id: heatId, participant_id: null, position: index + 1, seed: seed ?? index + 1, color: slotColor });
                    return;
                }

                let participant: ParticipantRecord | undefined;
                if (seed != null) participant = participantsBySeed.get(seed);
                if (!participant && slot.name) participant = participantsByName.get(slot.name.trim().toLowerCase());

                if (!participant) {
                    missingParticipants.push({ seed, name: slot.name });
                    return;
                }

                const participantFromDb = seed != null ? participantMap[seed] : undefined;
                entryRows.push({
                    heat_id: heatId, participant_id: participantFromDb?.id ?? participant.id,
                    position: index + 1, seed: seed ?? 0, color: slotColor,
                });
            });
        });
    });

    if (missingParticipants.length) {
        const missingList = missingParticipants.map((entry) => (entry.seed != null ? `seed ${entry.seed}` : entry.name ?? 'inconnu')).join(', ');
        throw new Error(`Participants manquants: ${missingList}`);
    }

    let deleteHeatIds: string[] = [];
    if (options.overwrite) {
        const { data: existing, error: existingError } = await supabase!.from('heats').select('id').eq('event_id', eventId).eq('division', category);
        if (existingError) throw existingError;
        if (existing?.length) deleteHeatIds = existing.map((row) => row.id);
    }

    const { error: rpcError } = await supabase!.rpc('bulk_upsert_heats', {
        p_heats: heatRows, p_entries: entryRows, p_mappings: slotMappings, p_participants: participantsPayload, p_delete_ids: options.overwrite ? deleteHeatIds : newHeatIds,
    } as any);

    if (rpcError) throw rpcError;
    return { heats: heatRows, entries: entryRows };
}

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

    const { error } = await supabase!.from('heat_entries').insert(payload);
    if (error) throw error;
}

export async function fetchHeatEntriesWithParticipants(heatId: string) {
    ensureSupabase();
    const normalizedHeatId = ensureHeatId(heatId);

    const { data, error } = await supabase!
        .from('heat_entries')
        .select('color, position, participant_id, seed, participant:participants(name, country, license)')
        .eq('heat_id', normalizedHeatId)
        .order('position', { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as any[];
    const typedRows: HeatEntriesWithParticipantRow[] = rows.map((row) => ({
        color: row.color, position: row.position, participant_id: row.participant_id, seed: row.seed,
        participant: row.participant ? { name: row.participant.name, country: row.participant.country, license: row.participant.license } : null,
    }));

    if (rows.length > 0 && rows.some((row) => row.participant?.name)) {
        return typedRows;
    }

    const { data: lineup, error: lineupError } = await supabase!
        .from('v_heat_lineup')
        .select('jersey_color, position, surfer_name, country, seed')
        .eq('heat_id', normalizedHeatId)
        .order('position', { ascending: true });

    if (lineupError) return typedRows;

    const fallbackEntries = (lineup ?? []).map((row: any) => ({
        color: row.jersey_color ?? null, position: row.position, participant_id: null, seed: row.seed ?? null,
        participant: row.surfer_name ? { name: row.surfer_name, country: row.country ?? null, license: null } : null,
    }));

    if (fallbackEntries.length === 0 && rows.length > 0) return typedRows;
    return fallbackEntries as HeatEntriesWithParticipantRow[];
}

export function subscribeToHeatUpdates(eventId: number, category: string, callback: () => void) {
    ensureSupabase();
    const heatPrefix = `event_${eventId}_${category.replace(/\s+/g, '_')}_`;
    const channel = supabase!
        .channel(`heats-${eventId}-${category}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'heat_entries' }, (payload) => {
            const heatId = (payload.new as { heat_id?: string } | null)?.heat_id;
            if (heatId && heatId.startsWith(heatPrefix)) callback();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `event_id=eq.${eventId}` }, callback)
        .subscribe();

    return () => { supabase?.removeChannel(channel); };
}

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

    if (error) return null;
    return data && data.length > 0 ? (data[0] as ActiveHeatPointer) : null;
}

export function parseActiveHeatId(heatId: string): { competition: string; division: string; round: number; heatNumber: number } | null {
    const match = heatId.match(/^(.+)_([^_]+)_r(\d+)_h(\d+)$/i);
    if (!match) return null;
    const fullName = match[1];
    const division = match[2];
    const round = parseInt(match[3], 10);
    const heatNumber = parseInt(match[4], 10);
    const competition = fullName.replace(/_/g, ' ').toUpperCase();
    return { competition, division: division.toUpperCase(), round, heatNumber };
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
    const heats = (data ?? []) as any[];
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

        const slots: HeatSlotSpec[] = colorOrder.map((color, idx) => {
            const entry = heat.heat_entries.find((row: any) => row.position === idx + 1);
            const mapping = heat.heat_slot_mappings?.find((row: any) => row.position === idx + 1);
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

export async function fetchAllEventHeats(eventId: number): Promise<Record<string, RoundSpec[]>> {
    const categories = await fetchAllEventCategories(eventId);
    const result: Record<string, RoundSpec[]> = {};

    for (const category of categories) {
        result[category] = await fetchCategoryHeats(eventId, category);
    }

    return result;
}

