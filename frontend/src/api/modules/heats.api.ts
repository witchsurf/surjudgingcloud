import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api';
import { getColorSet, type HeatColor } from '../../utils/colorUtils';
import { colorLabelMap } from '../../utils/colorUtils';
import { ensurePersistedHeatId } from '../../utils/heat';
import { parseActiveHeatId } from '../../utils/activeHeatId';
import { isStrictHeatCloseRpcUnavailable } from '../../utils/heatCloseErrors';
import type { RoundSpec, HeatSlotSpec } from '../../utils/bracket';
import type { ParticipantRecord } from '../../repositories/contracts/participants';
import type { SafePlanningPersistenceRequest } from '../../repositories/contracts/planningSafety';
import { persistSafePlanningRpc } from './planningSafety.api';
import { distributeSeedsSnake, expandSeedMap, type ParticipantSeed } from '../../utils/seeding';
import {
    parseHeatEntryJoinedRow,
    parseHeatRow,
    parseHeatSequenceRow,
    parseHeatSlotMapping,
    parseHeatSlotParticipant,
    parseHeatWithEntriesRow,
    parseLegacyLineupRow,
    parseRows,
    type HeatRow,
    type HeatSequenceRow,
} from './heatReadParsers';

export type { HeatRow, HeatSequenceRow } from './heatReadParsers';

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


export interface HeatJudgeAssignmentRow {
    heat_id: string;
    event_id: number | null;
    station: string;
    judge_id: string;
    judge_name: string;
    assigned_at?: string | null;
    updated_at?: string | null;
}

export interface PodiumJudgeAssignment {
    event_id: number;
    podium_id: string;
    station: string;
    judge_id: string;
    judge_name: string;
    updated_at?: string | null;
}

export interface PodiumHeatTransitionResult {
    event_id: number;
    podium_id: string;
    heat_id?: string;
    closed_heat_id?: string;
    division?: string;
    round?: number;
    heat_number?: number;
    panel_size?: number;
    qualifier_slots_updated?: number;
    division_slots_rebuilt?: number;
    next?: PodiumHeatTransitionResult | null;
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

export interface HeatEntryOverrideInput {
    heatId: string;
    position: number;
    color?: string | null;
    participantId?: number | null;
    name?: string | null;
    country?: string | null;
    reason?: string | null;
    createdBy?: string | null;
}

export interface HeatEntryOverrideResult {
    heat_id: string;
    position: number;
    color: string | null;
    participant_id: number;
    name: string;
    country: string | null;
    config_patch?: unknown;
}

export interface HeatStartDependencyBlocker {
    position?: number | null;
    placeholder?: string | null;
    source_round?: number | null;
    source_heat?: number | null;
    source_position?: number | null;
    source_heat_id?: string | null;
    source_status?: string | null;
    reason?: string | null;
    message?: string | null;
}

export interface HeatStartDependencyCheck {
    ok: boolean;
    heat_id?: string | null;
    blockers: HeatStartDependencyBlocker[];
}

const normalizeJoinedParticipant = parseHeatSlotParticipant;

async function buildRoundOneEntriesFromParticipants(heatId: string): Promise<HeatEntriesWithParticipantRow[]> {
    const metadata = await fetchHeatMetadata(heatId);
    if (!metadata?.event_id || !metadata.division || Number(metadata.round) !== 1) {
        return [];
    }

    const { data: roundHeats, error: heatsError } = await supabase!
        .from('heats')
        .select('id, heat_number, heat_size, color_order')
        .eq('event_id', metadata.event_id)
        .ilike('division', metadata.division)
        .eq('round', 1)
        .order('heat_number', { ascending: true });

    if (heatsError) throw heatsError;
    if (!roundHeats?.length) return [];

    const orderedHeats = roundHeats
        .filter((heat): heat is { id: string; heat_number: number; heat_size: number | null; color_order: string[] | null } =>
            Boolean(heat?.id) && Number.isFinite(Number(heat.heat_number))
        )
        .sort((a, b) => Number(a.heat_number) - Number(b.heat_number));

    const targetHeat = orderedHeats.find((heat) => ensurePersistedHeatId(heat.id) === heatId);
    if (!targetHeat) return [];

    const { data: participantRows, error: participantsError } = await supabase!
        .from('participants')
        .select('id, event_id, category, seed, name, country, license')
        .eq('event_id', metadata.event_id)
        .ilike('category', metadata.division)
        .order('seed', { ascending: true });

    if (participantsError) throw participantsError;
    if (!participantRows?.length) return [];

    const rawParticipants = (participantRows as any[])
        .map((participant, index) => ({
            id: participant.id,
            seed: Number.isFinite(Number(participant.seed)) ? Number(participant.seed) : null,
            implicitSeed: index + 1,
            name: participant.name,
            country: participant.country ?? undefined,
            license: participant.license ?? undefined,
        }))
        .sort((a, b) => {
            const aSeed = a.seed ?? Number.MAX_SAFE_INTEGER;
            const bSeed = b.seed ?? Number.MAX_SAFE_INTEGER;
            if (aSeed !== bSeed) return aSeed - bSeed;
            return a.implicitSeed - b.implicitSeed;
        });

    if (!rawParticipants.length) return [];

    const participants = rawParticipants.map((participant, index) => ({
        id: participant.id,
        seed: participant.seed ?? index + 1,
        name: participant.name,
        country: participant.country,
        license: participant.license,
    } satisfies ParticipantSeed));

    const heatSizes = orderedHeats.map((heat) => Math.max(0, Number(heat.heat_size) || 0));
    const maxHeatSize = Math.max(...heatSizes, 0);
    if (maxHeatSize <= 0) return [];

    const seedMap = distributeSeedsSnake(
        participants.map((participant) => participant.seed),
        {
            heatCount: orderedHeats.length,
            heatSize: maxHeatSize,
            heatSizes,
        }
    );

    const expanded = expandSeedMap(seedMap, participants);
    const targetExpandedHeat = expanded.find((heat) => heat.heatNumber === Number(targetHeat.heat_number));
    if (!targetExpandedHeat) return [];

    const fallbackColors = Array.isArray(targetHeat.color_order) && targetHeat.color_order.length > 0
        ? targetHeat.color_order
        : getColorSet(Number(targetHeat.heat_size) || targetExpandedHeat.slots.length);

    return targetExpandedHeat.slots.map((participant, index) => ({
        color: fallbackColors[index] ?? null,
        position: index + 1,
        participant_id: participant?.id ?? null,
        seed: participant?.seed ?? null,
        participant: participant
            ? {
                name: participant.name,
                country: participant.country ?? null,
                license: participant.license ?? null,
            }
            : null,
    }));
}

/** @deprecated Destructive legacy/rollback operation. Never use from modern planning workflows. */
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
    defaultJudges?: string[];
  tournamentType?: string;
  progressionEdges?: readonly Record<string, unknown>[];
}

export async function createHeatsWithEntries(
    eventId: number,
    eventName: string,
    category: string,
    rounds: RoundSpec[],
    participantsBySeed: Map<number, ParticipantRecord>,
    options: CreateHeatsOptions = {},
    persistPlanning: (request: SafePlanningPersistenceRequest) => Promise<void> = persistSafePlanningRpc,
): Promise<{ heats: HeatRow[]; entries: HeatEntryRow[] }> {
    ensureSupabase();
    const heatRows: Array<HeatRow & { is_active: false }> = [];
    const entryRows: HeatEntryRow[] = [];
    const heatConfigRows: Array<{
        heat_id: string;
        judges: string[];
        surfers: string[];
        judge_names: Record<string, string>;
        waves: number;
        tournament_type: string;
    }> = [];
    const slotMappings: HeatSlotMappingRow[] = [];
    const newHeatIds: string[] = [];
    const trimmedEventName = eventName.trim();
    const trimmedCategory = category.trim();

    const participantsByName = new Map<string, ParticipantRecord>();
    participantsBySeed.forEach((participant) => {
        participantsByName.set(participant.name.trim().toLowerCase(), participant);
    });

    const missingParticipants: Array<{ seed: number | null; name?: string }> = [];
    const defaultJudges = Array.isArray(options.defaultJudges) && options.defaultJudges.length > 0
        ? options.defaultJudges
        : ['J1', 'J2', 'J3'];
    const tournamentType = String(options.tournamentType ?? 'elimination').trim() || 'elimination';

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

    const plannedSchedules = new Set(
        rounds.flatMap((round) => round.heats.map((heat) => `${round.roundNumber}:${heat.heatNumber}`))
    );
    const unresolvedProgressionSlots = rounds.flatMap((round) => round.heats.flatMap((heat) =>
        round.roundNumber <= 1
            ? []
            : heat.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => Boolean(slot.placeholder))
                .flatMap(({ slot, index }) => {
                    const source = parsePlaceholder(slot.placeholder);
                    return source.sourceRound != null && source.sourceHeat != null && source.sourcePosition != null
                        && plannedSchedules.has(`${source.sourceRound}:${source.sourceHeat}`)
                        ? []
                        : [`R${round.roundNumber} H${heat.heatNumber} slot ${index + 1}`];
                })
    ));
    if (unresolvedProgressionSlots.length > 0) {
        throw new Error(`Planning refusé : progression explicite manquante pour ${unresolvedProgressionSlots.join(', ')}.`);
    }

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
                is_active: false,
            });
            heatConfigRows.push({
                heat_id: heatId,
                judges: defaultJudges,
                surfers: colorOrder.map((color) => colorLabelMap[color] ?? color),
                judge_names: {},
                waves: 15,
                tournament_type: tournamentType,
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

    // A future heat must never depend on a heuristic inferred at close time.
    // Compile every standard Rn-Hn-Pn placeholder into an immutable sporting
    // edge while the complete bracket is still known.
    const heatIdBySchedule = new Map(
        heatRows.map((heat) => [`${heat.round}:${heat.heat_number}`, heat.id] as const)
    );
    const generatedProgressionEdges = slotMappings.flatMap((mapping) => {
        if (
            mapping.source_round == null ||
            mapping.source_heat == null ||
            mapping.source_position == null
        ) return [];
        const sourceHeatId = heatIdBySchedule.get(`${mapping.source_round}:${mapping.source_heat}`);
        if (!sourceHeatId) {
            throw new Error(`Source de qualification introuvable pour ${mapping.heat_id}, slot ${mapping.position}.`);
        }
        return [{
            event_id: eventId,
            category,
            target_heat_id: mapping.heat_id,
            target_position: mapping.position,
            source_round: mapping.source_round,
            source_heat: sourceHeatId,
            source_position: mapping.source_position,
            progression_type: 'COMPETITION_RESULT',
        }];
    });
    const progressionByTarget = new Map<string, Record<string, unknown>>();
    [...generatedProgressionEdges, ...(options.progressionEdges ?? [])].forEach((edge) => {
        const targetHeatId = String(edge.target_heat_id ?? '').trim();
        const targetPosition = Number(edge.target_position);
        if (targetHeatId && Number.isInteger(targetPosition) && targetPosition > 0) {
            progressionByTarget.set(`${targetHeatId}:${targetPosition}`, edge);
        }
    });
    const unresolvedFutureEntries = entryRows.filter((entry) => {
        const targetRound = heatRows.find((heat) => heat.id === entry.heat_id)?.round ?? 1;
        return targetRound > 1 && entry.participant_id == null && !progressionByTarget.has(`${entry.heat_id}:${entry.position}`);
    });
    if (unresolvedFutureEntries.length > 0) {
        const slots = unresolvedFutureEntries.map((entry) => `${entry.heat_id}#${entry.position}`).join(', ');
        throw new Error(`Planning refusé : progression explicite manquante pour ${slots}.`);
    }

    await persistPlanning({
        eventId,
        category,
        proposedHeatIds: newHeatIds,
        overwrite: Boolean(options.overwrite),
        heats: heatRows as any,
        entries: entryRows as any,
        mappings: slotMappings as any,
        participants: participantsPayload,
        heatConfigs: heatConfigRows,
        progressionEdges: Array.from(progressionByTarget.values()),
    });

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
    return parseRows(data, parseHeatSequenceRow);
}

export async function fetchHeatMetadata(heatId: string): Promise<HeatRow | null> {
    ensureSupabase();
    const normalizedHeatId = ensurePersistedHeatId(heatId);
    const { data, error } = await supabase!
        .from('heats')
        .select('id, event_id, competition, division, round, heat_number, heat_size, status, color_order')
        .eq('id', normalizedHeatId)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseHeatRow(data) : null;
}

export async function fetchHeatBySchedule(
    eventId: number,
    division: string,
    round: number,
    heatNumber: number
): Promise<HeatRow | null> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('heats')
        .select('id, event_id, competition, division, round, heat_number, heat_size, status, color_order')
        .eq('event_id', eventId)
        .ilike('division', division.trim())
        .eq('round', round)
        .eq('heat_number', heatNumber)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseHeatRow(data) : null;
}

export async function fetchHeatJudgeAssignments(heatId: string): Promise<HeatJudgeAssignmentRow[]> {
    ensureSupabase();
    const normalizedHeatId = ensurePersistedHeatId(heatId);
    const { data, error } = await supabase!
        .from('heat_judge_assignments')
        .select('heat_id, event_id, station, judge_id, judge_name, assigned_at, updated_at')
        .eq('heat_id', normalizedHeatId)
        .order('station', { ascending: true });

    if (error) throw error;
    return (data ?? []) as HeatJudgeAssignmentRow[];
}

export async function fetchEventJudgeAssignments(eventId: number): Promise<HeatJudgeAssignmentRow[]> {
    ensureSupabase();
    const { data: heats, error: heatsError } = await supabase!
        .from('heats')
        .select('id')
        .eq('event_id', eventId);

    if (heatsError) throw heatsError;

    const heatIds = (heats ?? []).map((row: { id: string }) => ensurePersistedHeatId(row.id));
    if (!heatIds.length) return [];

    const { data, error } = await supabase!
        .from('heat_judge_assignments')
        .select('heat_id, event_id, station, judge_id, judge_name, assigned_at, updated_at')
        .in('heat_id', heatIds)
        .order('heat_id', { ascending: true })
        .order('station', { ascending: true });

    if (error) throw error;
    return (data ?? []) as HeatJudgeAssignmentRow[];
}

export async function replaceHeatEntries(heatId: string, rows: { position: number; participant_id: number | null; seed?: number | null; color?: string | null }[]) {
    ensureSupabase();
    const normalizedHeatId = ensurePersistedHeatId(heatId);
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
        seed: row.seed ?? 0,
        color: row.color ?? null,
    }));

    const { error } = await supabase!.from('heat_entries').insert(payload);
    if (error) throw error;
}

export async function fetchHeatEntriesWithParticipants(heatId: string): Promise<HeatEntriesWithParticipantRow[]> {
    ensureSupabase();
    const normalizedHeatId = ensurePersistedHeatId(heatId);

    const { data, error } = await supabase!
        .from('heat_entries')
        .select('color, position, participant_id, seed, participant:participants(name, country, license)')
        .eq('heat_id', normalizedHeatId)
        .order('position', { ascending: true });

    if (error) throw error;

    const rows = parseRows(data, parseHeatEntryJoinedRow);
    const typedRows: HeatEntriesWithParticipantRow[] = rows.map((row) => ({
        color: row.color, position: row.position, participant_id: row.participant_id, seed: row.seed,
        participant: (() => {
            const participant = normalizeJoinedParticipant(row.participant);
            return participant
                ? { name: participant.name, country: participant.country, license: participant.license }
                : null;
        })(),
    }));

    const { data: lineup, error: lineupError } = await supabase!
        .from('v_heat_lineup')
        .select('jersey_color, position, surfer_name, country, seed')
        .eq('heat_id', normalizedHeatId)
        .order('position', { ascending: true });

    if (lineupError) return typedRows;

    const fallbackEntries: HeatEntriesWithParticipantRow[] = parseRows(lineup, parseLegacyLineupRow).map((row) => ({
        color: row.jersey_color ?? null, position: row.position, participant_id: null, seed: row.seed ?? null,
        participant: row.surfer_name ? { name: row.surfer_name, country: row.country ?? null, license: null } : null,
    }));

    if (typedRows.length > 0 && fallbackEntries.length > 0) {
        const fallbackByPosition = new Map(fallbackEntries.map((entry) => [Number(entry.position), entry]));
        return typedRows.map((entry) => {
            if (entry.participant?.name) return entry;

            const fallback = fallbackByPosition.get(Number(entry.position));
            if (!fallback?.participant?.name) return entry;

            return {
                ...entry,
                color: entry.color ?? fallback.color,
                seed: entry.seed ?? fallback.seed,
                participant: fallback.participant,
            };
        });
    }

    if (fallbackEntries.length === 0 && rows.length > 0) return typedRows;
    if (fallbackEntries.length > 0) {
        return fallbackEntries;
    }

    const reconstructedEntries = await buildRoundOneEntriesFromParticipants(normalizedHeatId);
    if (reconstructedEntries.length > 0) {
        return reconstructedEntries;
    }

    return typedRows;
}

export async function fetchHeatEntriesWithParticipantsBatch(
    heatIds: string[]
): Promise<Map<string, HeatEntriesWithParticipantRow[]>> {
    ensureSupabase();
    const normalizedHeatIds = Array.from(new Set(heatIds.map(ensurePersistedHeatId).filter(Boolean)));
    const result = new Map<string, HeatEntriesWithParticipantRow[]>(
        normalizedHeatIds.map((heatId) => [heatId, []])
    );
    if (!normalizedHeatIds.length) return result;

    const [{ data: entries, error: entriesError }, { data: lineups, error: lineupsError }] = await Promise.all([
        supabase!
            .from('heat_entries')
            .select('heat_id, color, position, participant_id, seed, participant:participants(name, country, license)')
            .in('heat_id', normalizedHeatIds)
            .order('heat_id', { ascending: true })
            .order('position', { ascending: true }),
        supabase!
            .from('v_heat_lineup')
            .select('heat_id, jersey_color, position, surfer_name, country, seed')
            .in('heat_id', normalizedHeatIds)
            .order('heat_id', { ascending: true })
            .order('position', { ascending: true }),
    ]);

    if (entriesError) throw entriesError;

    const fallbackByHeat = new Map<string, HeatEntriesWithParticipantRow[]>();
    if (!lineupsError) {
        for (const row of parseRows(lineups, parseLegacyLineupRow)) {
            const heatId = ensurePersistedHeatId(row.heat_id || '');
            if (!heatId) continue;
            const rows = fallbackByHeat.get(heatId) ?? [];
            rows.push({
                color: row.jersey_color ?? null,
                position: row.position,
                participant_id: null,
                seed: row.seed ?? null,
                participant: row.surfer_name
                    ? { name: row.surfer_name, country: row.country ?? null, license: null }
                    : null,
            });
            fallbackByHeat.set(heatId, rows);
        }
    }

    const entriesByHeat = new Map<string, HeatEntriesWithParticipantRow[]>();
    for (const row of parseRows(entries, parseHeatEntryJoinedRow)) {
        const heatId = ensurePersistedHeatId(row.heat_id || '');
        if (!heatId) continue;
        const rows = entriesByHeat.get(heatId) ?? [];
        const participant = normalizeJoinedParticipant(row.participant);
        rows.push({
            color: row.color ?? null,
            position: row.position,
            participant_id: row.participant_id ?? null,
            seed: row.seed ?? null,
            participant: participant
                ? { name: participant.name, country: participant.country, license: participant.license }
                : null,
        });
        entriesByHeat.set(heatId, rows);
    }

    normalizedHeatIds.forEach((heatId) => {
        const typedRows = entriesByHeat.get(heatId) ?? [];
        const fallbackRows = fallbackByHeat.get(heatId) ?? [];
        if (!typedRows.length) {
            result.set(heatId, fallbackRows);
            return;
        }
        if (!fallbackRows.length) {
            result.set(heatId, typedRows);
            return;
        }
        const fallbackByPosition = new Map(fallbackRows.map((entry) => [Number(entry.position), entry]));
        result.set(heatId, typedRows.map((entry) => {
            if (entry.participant?.name) return entry;
            const fallback = fallbackByPosition.get(Number(entry.position));
            if (!fallback?.participant?.name) return entry;
            return {
                ...entry,
                color: entry.color ?? fallback.color,
                seed: entry.seed ?? fallback.seed,
                participant: fallback.participant,
            };
        }));
    });

    return result;
}

export async function adminOverrideHeatEntry(input: HeatEntryOverrideInput): Promise<HeatEntryOverrideResult> {
    ensureSupabase();
    const normalizedHeatId = ensurePersistedHeatId(input.heatId);

    const { data, error } = await supabase!.rpc('admin_override_heat_entry', {
        p_heat_id: normalizedHeatId,
        p_position: input.position,
        p_color: input.color ?? undefined,
        p_participant_id: input.participantId ?? undefined,
        p_name: input.name ?? undefined,
        p_country: input.country ?? undefined,
        p_reason: input.reason ?? undefined,
        p_created_by: input.createdBy ?? 'chief_judge',
    });

    if (error) throw error;
    return data as unknown as HeatEntryOverrideResult;
}

type CategoryHeatUpdateState = {
    channel: ReturnType<NonNullable<typeof supabase>['channel']> | null;
    listeners: Map<string, () => void>;
    knownHeatIds: Set<string>;
    refreshTimeout: ReturnType<typeof setTimeout> | null;
};

const categoryHeatUpdateRegistry = new Map<string, CategoryHeatUpdateState>();
let categoryHeatListenerSequence = 0;

const normalizeCategoryKey = (value: string) => value.trim().toUpperCase();

const emitCategoryHeatUpdate = (state: CategoryHeatUpdateState) => {
    for (const listener of state.listeners.values()) {
        try {
            listener();
        } catch (error) {
            console.error('❌ Category heat update listener failed:', error);
        }
    }
};

const scheduleCategoryHeatUpdate = (state: CategoryHeatUpdateState) => {
    if (state.refreshTimeout) {
        clearTimeout(state.refreshTimeout);
    }
    state.refreshTimeout = setTimeout(() => {
        emitCategoryHeatUpdate(state);
    }, 120);
};

const fetchCategoryHeatIds = async (eventId: number, category: string) => {
    const { data, error } = await supabase!
        .from('heats')
        .select('id')
        .eq('event_id', eventId)
        .eq('division', category);

    if (error) throw error;
    return new Set((data ?? []).map((row: { id: string }) => row.id));
};

const releaseCategoryHeatUpdate = (key: string) => {
    const state = categoryHeatUpdateRegistry.get(key);
    if (!state || state.listeners.size > 0) return;

    if (state.refreshTimeout) {
        clearTimeout(state.refreshTimeout);
    }

    if (state.channel && supabase) {
        try {
            state.channel.unsubscribe();
            supabase.removeChannel(state.channel);
        } catch (error) {
            console.warn('⚠️ Failed to release category heat update channel', key, error);
        }
    }

    categoryHeatUpdateRegistry.delete(key);
};

export function subscribeToHeatUpdates(eventId: number, category: string, callback: () => void) {
    ensureSupabase();
    const normalizedCategory = normalizeCategoryKey(category);
    const key = `${eventId}:${normalizedCategory}`;
    const existing = categoryHeatUpdateRegistry.get(key);
    const listenerId = `category-heat-listener-${++categoryHeatListenerSequence}`;

    if (existing) {
        existing.listeners.set(listenerId, callback);
        return () => {
            existing.listeners.delete(listenerId);
            releaseCategoryHeatUpdate(key);
        };
    }

    const state: CategoryHeatUpdateState = {
        channel: null,
        listeners: new Map([[listenerId, callback]]),
        knownHeatIds: new Set<string>(),
        refreshTimeout: null,
    };

    void fetchCategoryHeatIds(eventId, category)
        .then((heatIds) => {
            state.knownHeatIds = heatIds;
        })
        .catch((error) => {
            console.warn('⚠️ Unable to preload category heat ids', { eventId, category, error });
        });

    state.channel = supabase!
        .channel(`heats-${eventId}-${normalizedCategory}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'heats', filter: `event_id=eq.${eventId}` },
            (payload) => {
                const row = (payload.new || payload.old) as { id?: string; division?: string } | null;
                if (!row?.id) return;
                if (normalizeCategoryKey(row.division || '') !== normalizedCategory) return;

                if (payload.eventType === 'DELETE') {
                    state.knownHeatIds.delete(row.id);
                } else {
                    state.knownHeatIds.add(row.id);
                }
                scheduleCategoryHeatUpdate(state);
            }
        )
        .subscribe();

    categoryHeatUpdateRegistry.set(key, state);

    return () => {
        state.listeners.delete(listenerId);
        releaseCategoryHeatUpdate(key);
    };
}

export interface ActiveHeatPointer {
    event_id?: number | null;
    event_name: string;
    podium_id?: string | null;
    active_heat_id: string;
    updated_at: string;
}

export interface HeatRealtimeConfigWriteInput {
    status?: 'waiting' | 'running' | 'paused' | 'finished' | 'closed';
    timerStartTime?: string | null;
    setTimerStartTime?: boolean;
    timerDurationMinutes?: number | null;
    setTimerDuration?: boolean;
    configData?: unknown | null;
    setConfigData?: boolean;
    updatedBy?: string;
}

const isActiveHeatPointerEventIdSchemaError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
        status?: number;
        statusCode?: number;
    };
    const text = [
        candidate.code,
        candidate.message,
        candidate.details,
        candidate.hint,
        String(candidate.status ?? ''),
        String(candidate.statusCode ?? ''),
        JSON.stringify(candidate),
    ].join(' ').toLowerCase();

    return (
        (
            text.includes('active_heat_pointer')
            && (text.includes('event_id') || text.includes('podium_id'))
            && (
                text.includes('on_conflict')
                || text.includes('constraint')
                || text.includes('column')
                || text.includes('schema cache')
                || text.includes('42p')
                || text.includes('42703')
                || text.includes('pgrst')
                || text.includes('400')
            )
        )
        || text.includes('42p10')
        || text.includes('there is no unique or exclusion constraint matching the on conflict specification')
    );
};

const isRpcUnavailableError = (error: unknown, functionName: string) => {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
        status?: number;
        statusCode?: number;
    };
    const text = [
        candidate.code,
        candidate.message,
        candidate.details,
        candidate.hint,
        String(candidate.status ?? ''),
        String(candidate.statusCode ?? ''),
        JSON.stringify(candidate),
    ].join(' ').toLowerCase();
    const normalizedFunctionName = functionName.toLowerCase();

    return (
        text.includes('pgrst202')
        || text.includes('schema cache')
        || text.includes('could not find the function')
        || text.includes('function')
        || text.includes('42883')
    ) && text.includes(normalizedFunctionName);
};

const ACTIVE_HEAT_POINTER_EVENT_ID_CACHE_KEY = 'active_heat_pointer_event_id_upsert_support';
const ACTIVE_HEAT_POINTER_EVENT_ID_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let activeHeatPointerEventIdSupport: boolean | null = null;

const readActiveHeatPointerEventIdSupport = () => {
    if (activeHeatPointerEventIdSupport !== null) return activeHeatPointerEventIdSupport;
    if (typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(ACTIVE_HEAT_POINTER_EVENT_ID_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { supported?: boolean; at?: number };
        if (typeof parsed?.supported !== 'boolean' || typeof parsed?.at !== 'number') return null;
        if (Date.now() - parsed.at > ACTIVE_HEAT_POINTER_EVENT_ID_CACHE_TTL_MS) {
            window.localStorage.removeItem(ACTIVE_HEAT_POINTER_EVENT_ID_CACHE_KEY);
            return null;
        }
        activeHeatPointerEventIdSupport = parsed.supported;
        return activeHeatPointerEventIdSupport;
    } catch {
        return null;
    }
};

const writeActiveHeatPointerEventIdSupport = (supported: boolean) => {
    activeHeatPointerEventIdSupport = supported;
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(
            ACTIVE_HEAT_POINTER_EVENT_ID_CACHE_KEY,
            JSON.stringify({ supported, at: Date.now() })
        );
    } catch {
        // Ignore localStorage failures and keep the in-memory hint only.
    }
};

export async function upsertActiveHeatPointer(input: {
    eventId?: number | null;
    eventName: string;
    podiumId?: string | null;
    activeHeatId: string;
    updatedAt?: string;
}): Promise<void> {
    ensureSupabase();
    const podiumId = (input.podiumId || 'A').trim().toUpperCase() || 'A';

    const payload = {
        event_id: input.eventId ?? null,
        event_name: input.eventName,
        podium_id: podiumId,
        active_heat_id: ensurePersistedHeatId(input.activeHeatId),
        updated_at: input.updatedAt ?? new Date().toISOString(),
    };

    let { error: rpcError } = await supabase!.rpc('upsert_active_heat_pointer', {
        p_event_id: payload.event_id ?? undefined,
        p_event_name: payload.event_name,
        p_active_heat_id: payload.active_heat_id,
        p_updated_at: payload.updated_at,
        p_podium_id: payload.podium_id,
    });

    if (rpcError && isRpcUnavailableError(rpcError, 'upsert_active_heat_pointer')) {
        const legacyResult = await supabase!.rpc('upsert_active_heat_pointer', {
            p_event_id: payload.event_id ?? undefined,
            p_event_name: payload.event_name,
            p_active_heat_id: payload.active_heat_id,
            p_updated_at: payload.updated_at,
        });
        rpcError = legacyResult.error;
    }

    if (!rpcError) {
        return;
    }

    if (!isRpcUnavailableError(rpcError, 'upsert_active_heat_pointer')) {
        throw rpcError;
    }

    const fallbackPayload = {
        event_name: input.eventName,
        podium_id: podiumId,
        active_heat_id: ensurePersistedHeatId(input.activeHeatId),
        updated_at: payload.updated_at,
    };

    const selectExisting = async (includePodium: boolean) => {
        let query = supabase!
            .from('active_heat_pointer')
            .select('active_heat_id');

        if (input.eventId && Number.isFinite(input.eventId)) {
            query = query.eq('event_id', input.eventId);
        } else {
            query = query.eq('event_name', input.eventName);
        }

        if (includePodium) {
            query = query.eq('podium_id', podiumId);
        }

        return query.limit(1);
    };

    let includePodiumInFallback = true;
    let { data: existingRows, error: selectError } = await selectExisting(includePodiumInFallback);

    if (selectError && isActiveHeatPointerEventIdSchemaError(selectError)) {
        includePodiumInFallback = false;
        ({ data: existingRows, error: selectError } = await selectExisting(includePodiumInFallback));
    }

    if (selectError) throw selectError;

    if ((existingRows ?? []).length > 0) {
        let updateQuery = supabase!
            .from('active_heat_pointer')
            .update(includePodiumInFallback ? fallbackPayload : {
                event_name: fallbackPayload.event_name,
                active_heat_id: fallbackPayload.active_heat_id,
                updated_at: fallbackPayload.updated_at,
            });

        if (input.eventId && Number.isFinite(input.eventId)) {
            updateQuery = updateQuery.eq('event_id', input.eventId);
        } else {
            updateQuery = updateQuery.eq('event_name', input.eventName);
        }

        if (includePodiumInFallback) {
            updateQuery = updateQuery.eq('podium_id', podiumId);
        }

        const { error: updateError } = await updateQuery;

        if (updateError) throw updateError;
        return;
    }

    const { error: insertError } = await supabase!
        .from('active_heat_pointer')
        .insert(includePodiumInFallback ? payload : {
            event_id: payload.event_id,
            event_name: payload.event_name,
            active_heat_id: payload.active_heat_id,
            updated_at: payload.updated_at,
        });

    if (insertError) throw insertError;
}

export async function fetchPodiumJudgePanel(
    eventId: number,
    podiumIdInput?: string | null,
): Promise<PodiumJudgeAssignment[]> {
    ensureSupabase();
    const podiumId = (podiumIdInput || 'A').trim().toUpperCase() || 'A';
    const { data, error } = await supabase!
        .from('podium_judge_assignments')
        .select('event_id,podium_id,station,judge_id,judge_name,updated_at')
        .eq('event_id', eventId)
        .eq('podium_id', podiumId)
        .order('station', { ascending: true });

    if (error) throw error;
    return (data || []) as PodiumJudgeAssignment[];
}

export async function setPodiumJudgePanel(input: {
    eventId: number;
    podiumId?: string | null;
    assignments: Array<{ station: string; judgeId: string; judgeName: string }>;
    assignedBy?: string;
}): Promise<number> {
    ensureSupabase();
    const podiumId = (input.podiumId || 'A').trim().toUpperCase() || 'A';
    const { data, error } = await supabase!.rpc('set_podium_judge_panel', {
        p_event_id: input.eventId,
        p_podium_id: podiumId,
        p_assignments: input.assignments.map((assignment) => ({
            station: assignment.station,
            judge_id: assignment.judgeId,
            judge_name: assignment.judgeName,
        })),
        p_assigned_by: input.assignedBy || 'admin',
    });

    if (error) throw error;
    return Number(data || 0);
}

export async function activateHeatOnPodium(input: {
    eventId: number;
    podiumId?: string | null;
    heatId: string;
    assignedBy?: string;
}): Promise<PodiumHeatTransitionResult> {
    ensureSupabase();
    const podiumId = (input.podiumId || 'A').trim().toUpperCase() || 'A';
    const { data, error } = await supabase!.rpc('activate_heat_on_podium', {
        p_event_id: input.eventId,
        p_podium_id: podiumId,
        p_heat_id: ensurePersistedHeatId(input.heatId),
        p_assigned_by: input.assignedBy || 'admin',
    });

    if (error) throw error;
    return (data || {}) as unknown as PodiumHeatTransitionResult;
}

export async function closeHeatOnPodium(input: {
    eventId: number;
    podiumId?: string | null;
    heatId: string;
    nextHeatId?: string | null;
    closedBy?: string;
    force?: boolean;
    forceReason?: string | null;
}): Promise<PodiumHeatTransitionResult> {
    ensureSupabase();
    const podiumId = (input.podiumId || 'A').trim().toUpperCase() || 'A';
    let { data, error } = await supabase!.rpc('close_heat_on_podium_strict', {
        p_event_id: input.eventId,
        p_podium_id: podiumId,
        p_heat_id: ensurePersistedHeatId(input.heatId),
        p_next_heat_id: (input.nextHeatId ? ensurePersistedHeatId(input.nextHeatId) : null) as unknown as string | undefined,
        p_closed_by: input.closedBy || 'admin',
        p_force: Boolean(input.force),
        p_force_reason: (input.forceReason?.trim() || null) as unknown as string | undefined,
    });

    const strictRpcUnavailable = isStrictHeatCloseRpcUnavailable(error);
    if (strictRpcUnavailable && !input.force) {
        ({ data, error } = await supabase!.rpc('close_heat_on_podium', {
            p_event_id: input.eventId,
            p_podium_id: podiumId,
            p_heat_id: ensurePersistedHeatId(input.heatId),
            p_next_heat_id: (input.nextHeatId ? ensurePersistedHeatId(input.nextHeatId) : null) as unknown as string | undefined,
            p_closed_by: input.closedBy || 'admin',
        }));
    }

    if (error) throw error;
    return (data || {}) as unknown as PodiumHeatTransitionResult;
}

const buildHeatRealtimePatch = (input: HeatRealtimeConfigWriteInput) => {
    const patch: Record<string, unknown> = {
        updated_by: input.updatedBy ?? 'system',
    };

    if (typeof input.status === 'string' && input.status.trim()) {
        patch.status = input.status;
    }
    if (input.setTimerStartTime) {
        patch.timer_start_time = input.timerStartTime ?? null;
    }
    if (input.setTimerDuration) {
        patch.timer_duration_minutes = input.timerDurationMinutes ?? null;
    }
    if (input.setConfigData) {
        patch.config_data = input.configData ?? null;
    }

    return patch;
};

const fallbackUpsertHeatRealtimeConfig = async (
    normalizedHeatId: string,
    input: HeatRealtimeConfigWriteInput
) => {
    const patch = buildHeatRealtimePatch(input);

    const { data: existingRow, error: readError } = await supabase!
        .from('heat_realtime_config')
        .select('heat_id')
        .eq('heat_id', normalizedHeatId)
        .maybeSingle();

    if (readError && readError.code !== 'PGRST116') {
        throw readError;
    }

    if (existingRow) {
        const { error: updateError } = await supabase!
            .from('heat_realtime_config')
            .update(patch)
            .eq('heat_id', normalizedHeatId);

        if (updateError) throw updateError;
        return;
    }

    const insertPayload: any = {
        heat_id: normalizedHeatId,
        updated_by: input.updatedBy ?? 'system',
        status: input.status ?? 'waiting',
        timer_start_time: input.setTimerStartTime ? (input.timerStartTime ?? null) : null,
        timer_duration_minutes: input.setTimerDuration ? (input.timerDurationMinutes ?? null) : null,
        config_data: input.setConfigData ? (input.configData ?? null) : null,
    };

    const { error: insertError } = await supabase!
        .from('heat_realtime_config')
        .insert(insertPayload);

    if (insertError) throw insertError;
};

export async function upsertHeatRealtimeConfig(
    heatId: string,
    input: HeatRealtimeConfigWriteInput
): Promise<void> {
    ensureSupabase();

    const normalizedHeatId = ensurePersistedHeatId(heatId);
    const { error } = await supabase!.rpc('upsert_heat_realtime_config', {
        p_heat_id: normalizedHeatId,
        p_status: (input.status ?? undefined) as any,
        p_set_timer_start_time: Boolean(input.setTimerStartTime),
        p_timer_start_time: input.setTimerStartTime ? (input.timerStartTime ?? undefined) : undefined,
        p_set_timer_duration: Boolean(input.setTimerDuration),
        p_timer_duration_minutes: input.setTimerDuration ? (input.timerDurationMinutes ?? undefined) : undefined,
        p_set_config_data: Boolean(input.setConfigData),
        p_config_data: input.setConfigData ? ((input.configData as any) ?? undefined) : undefined,
        p_updated_by: input.updatedBy ?? 'system',
    });

    if (!error) {
        return;
    }

    if (!isRpcUnavailableError(error, 'upsert_heat_realtime_config')) {
        throw error;
    }

    await fallbackUpsertHeatRealtimeConfig(normalizedHeatId, input);
}

export async function propagateQualifiersForSourceHeat(heatId: string): Promise<number> {
    ensureSupabase();

    const normalizedHeatId = ensurePersistedHeatId(heatId);
    const { data, error } = await supabase!.rpc('fn_propagate_qualifiers_for_source_heat', {
        p_source_heat_id: normalizedHeatId,
    });

    if (error) {
        if (isRpcUnavailableError(error, 'fn_propagate_qualifiers_for_source_heat')) {
            throw new Error('RPC_UNAVAILABLE:fn_propagate_qualifiers_for_source_heat');
        }
        throw error;
    }

    return Number(data ?? 0);
}

export async function rebuildDivisionQualifiersFromScores(eventId: number, division: string): Promise<number> {
    ensureSupabase();

    const { data, error } = await supabase!.rpc('rebuild_division_qualifiers_from_scores', {
        p_event_id: eventId,
        p_division: division,
    });

    if (error) {
        if (isRpcUnavailableError(error, 'rebuild_division_qualifiers_from_scores')) {
            throw new Error('RPC_UNAVAILABLE:rebuild_division_qualifiers_from_scores');
        }
        throw error;
    }

    return Number(data ?? 0);
}

export async function validateHeatStartDependencies(heatId: string): Promise<HeatStartDependencyCheck> {
    ensureSupabase();

    const normalizedHeatId = ensurePersistedHeatId(heatId);
    const { data, error } = await supabase!.rpc('validate_heat_start_dependencies', {
        p_heat_id: normalizedHeatId,
    });

    if (error) {
        if (isRpcUnavailableError(error, 'validate_heat_start_dependencies')) {
            throw new Error('RPC_UNAVAILABLE:validate_heat_start_dependencies');
        }
        throw error;
    }

    const result = (data || {}) as Partial<HeatStartDependencyCheck>;
    return {
        ok: Boolean(result.ok),
        heat_id: result.heat_id ?? normalizedHeatId,
        blockers: Array.isArray(result.blockers) ? result.blockers : [],
    };
}

export async function fetchActiveHeatPointer(eventId?: number | null, eventName?: string, podiumIdInput?: string | null): Promise<ActiveHeatPointer | null> {
    ensureSupabase();
    const podiumId = (podiumIdInput || 'A').trim().toUpperCase() || 'A';
    const eventIdSupport = readActiveHeatPointerEventIdSupport();
    const canUseEventId = Boolean(
        eventId
        && Number.isFinite(eventId)
        && (eventIdSupport === true || !eventName)
    );

    const runQuery = async (filterByEventId: boolean) => {
        let query = supabase!
            .from('active_heat_pointer')
            .select('*')
            .order('updated_at', { ascending: false });

        if (filterByEventId && eventId && Number.isFinite(eventId)) {
            query = query.eq('event_id', eventId);
        } else if (eventName) {
            query = query.eq('event_name', eventName);
        }

        query = query.eq('podium_id', podiumId);

        return query.limit(1);
    };

    let { data, error } = await runQuery(canUseEventId);

    if (error && isActiveHeatPointerEventIdSchemaError(error)) {
        const runLegacyQuery = async (filterByEventId: boolean) => {
            let query = supabase!
                .from('active_heat_pointer')
                .select('*')
                .order('updated_at', { ascending: false });

            if (filterByEventId && eventId && Number.isFinite(eventId)) {
                query = query.eq('event_id', eventId);
            } else if (eventName) {
                query = query.eq('event_name', eventName);
            }

            return query.limit(1);
        };

        ({ data, error } = await runLegacyQuery(canUseEventId));
    }

    if (!error && canUseEventId) {
        writeActiveHeatPointerEventIdSupport(true);
    }

    if (error && canUseEventId && eventName && isActiveHeatPointerEventIdSchemaError(error)) {
        writeActiveHeatPointerEventIdSupport(false);
        ({ data, error } = await runQuery(false));
    }

    if (error) return null;
    return data && data.length > 0 ? (data[0] as ActiveHeatPointer) : null;
}

export { parseActiveHeatId };



export async function fetchHeatSlotMappings(heatId: string): Promise<HeatSlotMappingRow[]> {
    ensureSupabase();
    const normalizedHeatId = ensurePersistedHeatId(heatId);
    const { data, error } = await supabase!
        .from('heat_slot_mappings')
        .select('position, placeholder, source_round, source_heat, source_position')
        .eq('heat_id', normalizedHeatId)
        .order('position', { ascending: true });

    if (error) throw error;
    return parseRows(data, parseHeatSlotMapping).map((row) => ({
        heat_id: normalizedHeatId,
        position: row.position,
        placeholder: row.placeholder,
        source_round: row.source_round,
        source_heat: row.source_heat,
        source_position: row.source_position,
    }));
}

export async function fetchHeatSlotMappingsBatch(
    heatIds: string[]
): Promise<Map<string, HeatSlotMappingRow[]>> {
    ensureSupabase();
    const normalizedHeatIds = Array.from(new Set(heatIds.map(ensurePersistedHeatId).filter(Boolean)));
    const result = new Map<string, HeatSlotMappingRow[]>(
        normalizedHeatIds.map((heatId) => [heatId, []])
    );
    if (!normalizedHeatIds.length) return result;

    const { data, error } = await supabase!
        .from('heat_slot_mappings')
        .select('heat_id, position, placeholder, source_round, source_heat, source_position')
        .in('heat_id', normalizedHeatIds)
        .order('heat_id', { ascending: true })
        .order('position', { ascending: true });

    if (error) throw error;
    for (const parsed of parseRows(data, parseHeatSlotMapping)) {
        const heatId = ensurePersistedHeatId(parsed.heat_id || '');
        if (!heatId) continue;
        const row: HeatSlotMappingRow = { ...parsed, heat_id: heatId };
        const rows = result.get(heatId) ?? [];
        rows.push(row);
        result.set(heatId, rows);
    }
    return result;
}

const prettyRoundName = (roundNumber: number, maxRound: number): string => {
    if (roundNumber === maxRound && maxRound > 1) return 'Finale';
    return `Round ${roundNumber}`;
};

export async function fetchCategoryHeats(eventId: number, category: string): Promise<RoundSpec[]> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('heats')
        .select(`id, round, heat_number, heat_size, color_order, status, heat_entries ( position, seed, color, participant:participants ( id, name, country, license ) ), heat_slot_mappings ( position, placeholder, source_round, source_heat, source_position )`)
        .eq('event_id', eventId)
        .eq('division', category)
        .order('round', { ascending: true })
        .order('heat_number', { ascending: true })
        .order('position', { ascending: true, foreignTable: 'heat_entries' });

    if (error) throw error;
    const heats = parseRows(data, parseHeatWithEntriesRow);
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
            const entry = heat.heat_entries.find((row) => row.position === idx + 1);
            const mapping = heat.heat_slot_mappings.find((row) => row.position === idx + 1);
            const participant = normalizeJoinedParticipant(entry?.participant);
            if (entry && participant) {
                const entryColor = entry.color ? (entry.color.toUpperCase() as HeatColor) : undefined;
                const resolvedColor = entryColor && allowedColors.includes(entryColor) ? entryColor : color;
                return {
                    seed: entry.seed ?? undefined,
                    name: participant.name,
                    country: participant.country ?? undefined,
                    license: participant.license ?? undefined,
                    participantId: (entry.participant_id ?? participant.id) ?? undefined,
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
            status: heat.status,
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

    if (divisions.length > 0) {
        return divisions.sort();
    }

    // Fallback: If no heats exist, fetch categories from the event table
    const { data: eventData, error: eventError } = await supabase!
        .from('events')
        .select('categories')
        .eq('id', eventId)
        .maybeSingle();

    if (eventError) throw eventError;

    if (eventData?.categories && Array.isArray(eventData.categories)) {
        const eventCategories = eventData.categories.map(c => typeof c === 'string' ? c : String(c)).filter(Boolean);
        return [...new Set(eventCategories)].sort();
    }

    return [];
}

export async function fetchAllEventHeats(eventId: number): Promise<Record<string, RoundSpec[]>> {
    const categories = await fetchAllEventCategories(eventId);
    const result: Record<string, RoundSpec[]> = {};

    for (const category of categories) {
        result[category] = await fetchCategoryHeats(eventId, category);
    }

    return result;
}
