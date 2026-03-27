/**
 * Heat Repository
 * 
 * Manages heat-related database operations.
 * Handles heat creation, status updates, entries, and sequences.
 */

import { BaseRepository } from './BaseRepository';
import { ensureHeatId } from '../utils/heat';
import { logger } from '../lib/logger';
import { saveOffline } from '../lib/supabase';
import { distributeSeedsSnake, expandSeedMap, type ParticipantSeed } from '../utils/seeding';
import { getColorSet } from '../utils/colorUtils';

export interface HeatEntryWithParticipant {
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

export interface OrderedHeat {
    round: number;
    heat_number: number;
    status: string;
    id: string;
}

export interface HeatJudgeAssignment {
    heat_id: string;
    event_id?: number | null;
    station: string;
    judge_id: string;
    judge_name: string;
}

interface ParticipantRow {
    id: number;
    event_id: number;
    category: string;
    seed: number;
    name: string;
    country: string | null;
    license: string | null;
}

interface HeatMetadataRow {
    id: string;
    event_id: number | null;
    competition: string | null;
    division: string | null;
    round: number | null;
    heat_number: number | null;
    heat_size: number | null;
    color_order: string[] | null;
}

/**
 * Repository for managing heats
 */
export class HeatRepository extends BaseRepository {
    constructor() {
        super('heats');
    }

    /**
     * Fetch heat entries with participant information
     */
    async fetchHeatEntriesWithParticipants(heatId: string): Promise<HeatEntryWithParticipant[]> {
        const normalizedHeatId = ensureHeatId(heatId);

        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('heat_entries')
                    .select('color, position, participant_id, seed, participant:participants(name, country, license)')
                    .eq('heat_id', normalizedHeatId)
                    .order('position', { ascending: true });

                if (error) throw error;

                logger.info('HeatRepository', 'Heat entries fetched', { heatId: normalizedHeatId, count: data?.length || 0 });
                return (data || []) as unknown as HeatEntryWithParticipant[];
            },
            undefined,
            'fetchHeatEntriesWithParticipants'
        );
    }

    /**
     * Fetch ordered heat sequence for an event/division
     */
    async fetchOrderedHeatSequence(eventId: number, division: string): Promise<OrderedHeat[]> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('heats')
                    .select('id, round, heat_number, status')
                    .eq('event_id', eventId)
                    .eq('division', division)
                    .order('round', { ascending: true })
                    .order('heat_number', { ascending: true });

                if (error) throw error;

                logger.info('HeatRepository', 'Heat sequence fetched', { eventId, division, count: data?.length || 0 });
                return (data || []) as OrderedHeat[];
            },
            undefined,
            'fetchOrderedHeatSequence'
        );
    }

    /**
     * Update heat status with offline fallback
     */
    async updateHeatStatus(heatId: string, status: string, closedAt?: string): Promise<void> {
        const normalizedHeatId = ensureHeatId(heatId);
        const updateData: Record<string, any> = { status };
        if (closedAt) {
            updateData.closed_at = closedAt;
        }

        return this.execute(
            async () => {
                this.ensureSupabase();

                const { error } = await this.supabase!
                    .from('heats')
                    .update(updateData)
                    .eq('id', normalizedHeatId);

                if (error) throw error;

                logger.info('HeatRepository', 'Heat status updated online', { heatId: normalizedHeatId, status });
            },
            () => {
                logger.info('HeatRepository', 'Heat status queued offline', { heatId: normalizedHeatId, status });
                saveOffline({
                    table: 'heats',
                    action: 'update',
                    payload: { id: normalizedHeatId, data: updateData },
                    timestamp: Date.now()
                });
            },
            'updateHeatStatus'
        );
    }

    /**
     * Save Heat Configuration (Surfers, Colors, Judges)
     */
    async saveHeatConfig(heatId: string, config: any): Promise<void> {
        const normalizedHeatId = ensureHeatId(heatId);
        const assignmentPayload = this.buildJudgeAssignments(normalizedHeatId, config);
        
        const payload = {
            heat_id: normalizedHeatId,
            judges: Array.isArray(config?.judges) ? config.judges : [],
            surfers: Array.isArray(config?.surfers) ? config.surfers : [],
            judge_names: config?.judge_names ?? config?.judgeNames ?? {},
            waves: Number.isFinite(Number(config?.waves)) ? Number(config.waves) : 15,
            tournament_type: config?.tournament_type ?? config?.tournamentType ?? 'elimination'
        };

        return this.execute(
            async () => {
                this.ensureSupabase();
                const { error } = await this.supabase!
                    .from('heat_configs')
                    .upsert(payload, { onConflict: 'heat_id' });

                if (error) throw error;
                if (assignmentPayload.length > 0) {
                    const { error: assignmentError } = await this.supabase!
                        .from('heat_judge_assignments')
                        .upsert(assignmentPayload, { onConflict: 'heat_id,station' });

                    if (assignmentError) throw assignmentError;
                }
                await this.ensureHeatEntries(normalizedHeatId, config);
                await this.ensureEventLastConfigSnapshot(normalizedHeatId, config, assignmentPayload);
                logger.info('HeatRepository', 'Heat config saved online', { heatId: normalizedHeatId });
            },
            () => {
                logger.info('HeatRepository', 'Heat config queued offline', { heatId: normalizedHeatId });
                saveOffline({
                    table: 'heat_configs',
                    action: 'insert',
                    payload: payload,
                    timestamp: Date.now()
                });
                if (assignmentPayload.length > 0) {
                    saveOffline({
                        table: 'heat_judge_assignments',
                        action: 'upsert',
                        payload: {
                            rows: assignmentPayload,
                            options: { onConflict: 'heat_id,station' }
                        },
                        timestamp: Date.now()
                    });
                }
            },
            'saveHeatConfig'
        );
    }

    async fetchHeatJudgeAssignments(heatId: string): Promise<HeatJudgeAssignment[]> {
        const normalizedHeatId = ensureHeatId(heatId);

        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('heat_judge_assignments')
                    .select('heat_id, event_id, station, judge_id, judge_name')
                    .eq('heat_id', normalizedHeatId)
                    .order('station', { ascending: true });

                if (error) throw error;

                return (data ?? []) as HeatJudgeAssignment[];
            },
            () => [],
            'fetchHeatJudgeAssignments'
        );
    }

    /**
     * Create Heat with offline resilience
     */
    async createHeat(heatData: any): Promise<void> {
        return this.execute(
            async () => {
                this.ensureSupabase();
                const { error } = await this.supabase!
                    .from('heats')
                    .upsert(heatData, { onConflict: 'id' });

                if (error) throw error;
                logger.info('HeatRepository', 'Heat created online', { heat: heatData });
            },
            () => {
                logger.info('HeatRepository', 'Heat created offline', { heat: heatData });
                saveOffline({
                    table: 'heats',
                    action: 'upsert',
                    payload: {
                        rows: heatData,
                        options: { onConflict: 'id' }
                    },
                    timestamp: Date.now()
                });
            },
            'createHeat'
        );
    }

    /**
     * Delete planned heats for an event/category
     */
    async deletePlannedHeats(eventId: number, category: string): Promise<void> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                // Find planned/open heats
                const { data: planned, error } = await this.supabase!
                    .from('heats')
                    .select('id')
                    .eq('event_id', eventId)
                    .eq('division', category)
                    .in('status', ['planned', 'open']);

                if (error) throw error;
                if (!planned || planned.length === 0) return;

                const heatIds = planned.map((row) => row.id);

                // Delete heat entries first
                await this.supabase!.from('heat_entries').delete().in('heat_id', heatIds);

                // Delete heats
                const { error: deleteError } = await this.supabase!
                    .from('heats')
                    .delete()
                    .in('id', heatIds);

                if (deleteError) throw deleteError;

                logger.info('HeatRepository', 'Planned heats deleted', { eventId, category, count: heatIds.length });
            },
            undefined,
            'deletePlannedHeats'
        );
    }

    /**
     * Fetch all distinct divisions/categories for an event
     */
    async fetchAllEventCategories(eventId: number): Promise<string[]> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('heats')
                    .select('division')
                    .eq('event_id', eventId);

                if (error) throw error;

                const divisions = [...new Set((data ?? []).map((h: any) => h.division))];
                logger.info('HeatRepository', 'Event categories fetched', { eventId, count: divisions.length });
                return divisions.sort();
            },
            undefined,
            'fetchAllEventCategories'
        );
    }

    private buildJudgeAssignments(heatId: string, config: any): HeatJudgeAssignment[] {
        const judgeIds = Array.isArray(config?.judges) ? config.judges : [];
        const configJudgeNames = config?.judge_names ?? config?.judgeNames ?? {};
        const configJudgeIdentities = config?.judge_identities ?? config?.judgeIdentities ?? {};
        const eventId = Number.isFinite(Number(config?.event_id)) ? Number(config.event_id) : null;

        const safeJudgeNames = Object.fromEntries(
            Object.entries(configJudgeNames).map(([k, v]) => [k.trim().toUpperCase(), v])
        );
        const safeJudgeIdentities = Object.fromEntries(
            Object.entries(configJudgeIdentities).map(([k, v]) => [k.trim().toUpperCase(), v])
        );

        return judgeIds
            .map((stationRaw: unknown) => String(stationRaw ?? '').trim().toUpperCase())
            .filter((station: string) => station.length > 0)
            .map((station: string) => ({
                heat_id: heatId,
                event_id: eventId,
                station,
                judge_id: String(safeJudgeIdentities[station] ?? station).trim() || station,
                judge_name: String(safeJudgeNames[station] ?? station).trim() || station,
            }));
    }

    private async fetchHeatMetadata(heatId: string): Promise<HeatMetadataRow | null> {
        const { data, error } = await this.supabase!
            .from('heats')
            .select('id, event_id, competition, division, round, heat_number, heat_size, color_order')
            .eq('id', heatId)
            .maybeSingle();

        if (error) throw error;
        return (data as HeatMetadataRow | null) ?? null;
    }

    private async fetchHeatEntriesWithParticipantsRaw(heatId: string): Promise<Array<{
        color: string | null;
        position: number;
        participant_id: number | null;
        seed: number | null;
        participant: {
            name: string;
            country: string | null;
            license: string | null;
        } | null;
    }>> {
        const { data, error } = await this.supabase!
            .from('heat_entries')
            .select('color, position, participant_id, seed, participant:participants(name, country, license)')
            .eq('heat_id', heatId)
            .order('position', { ascending: true });

        if (error) throw error;
        return (data ?? []).map((row: any) => ({
            color: row.color ?? null,
            position: row.position,
            participant_id: row.participant_id ?? null,
            seed: row.seed ?? null,
            participant: Array.isArray(row.participant) ? (row.participant[0] ?? null) : (row.participant ?? null),
        })) as Array<{
            color: string | null;
            position: number;
            participant_id: number | null;
            seed: number | null;
            participant: {
                name: string;
                country: string | null;
                license: string | null;
            } | null;
        }>;
    }

    private async ensureHeatEntries(heatId: string, config: any): Promise<void> {
        const existingEntries = await this.fetchHeatEntriesWithParticipantsRaw(heatId);
        if (existingEntries.length > 0) {
            return;
        }

        const createdFromConfig = await this.ensureHeatEntriesFromConfiguredLineup(heatId, config);
        if (createdFromConfig) {
            return;
        }

        await this.ensureRoundOneHeatEntries(heatId, config);
    }

    private async ensureHeatEntriesFromConfiguredLineup(heatId: string, config: any): Promise<boolean> {
        const eventId = Number.isFinite(Number(config?.event_id)) ? Number(config.event_id) : null;
        const division = String(config?.division ?? '').trim();
        const surfers = Array.isArray(config?.surfers) ? config.surfers.map((value: unknown) => String(value ?? '').trim()).filter(Boolean) : [];
        const surferNames = config?.surfer_names ?? config?.surferNames ?? {};

        if (!eventId || !division || surfers.length === 0) {
            return false;
        }

        const heatMeta = await this.fetchHeatMetadata(heatId);
        if (!heatMeta) {
            return false;
        }

        const requestedNames = surfers
            .map((color: string) => String(surferNames?.[color] ?? '').trim())
            .filter(Boolean);

        const { data: participantRows, error: participantsError } = await this.supabase!
            .from('participants')
            .select('id, event_id, category, seed, name, country, license')
            .eq('event_id', eventId)
            .ilike('category', division)
            .order('seed', { ascending: true });

        if (participantsError) throw participantsError;

        const availableParticipants = (participantRows ?? []) as ParticipantRow[];
        const participantByName = new Map(
            availableParticipants.map((participant) => [participant.name.trim().toLowerCase(), participant] as const)
        );

        const colorOrder = Array.isArray(heatMeta.color_order) && heatMeta.color_order.length > 0
            ? heatMeta.color_order
            : surfers.length > 0
                ? surfers
                : getColorSet(Number(heatMeta.heat_size) || surfers.length);

        const entryPayload = surfers.map((color: string, index: number) => {
            const resolvedName = String(surferNames?.[color] ?? '').trim();
            const matchedParticipant = resolvedName
                ? participantByName.get(resolvedName.toLowerCase()) ?? null
                : null;

            return {
                heat_id: heatId,
                participant_id: matchedParticipant?.id ?? null,
                position: index + 1,
                seed: Number.isFinite(Number(matchedParticipant?.seed)) ? Number(matchedParticipant?.seed!) : index + 1,
                color: colorOrder[index] ?? color,
            };
        });

        if (entryPayload.length === 0) {
            return false;
        }

        const { error: insertError } = await this.supabase!
            .from('heat_entries')
            .upsert(entryPayload, { onConflict: 'heat_id,position' });

        if (insertError) throw insertError;

        logger.info('HeatRepository', 'Heat entries created from configured lineup', {
            heatId,
            eventId,
            division,
            entryCount: entryPayload.length,
            matchedParticipants: requestedNames.length,
        });

        return true;
    }

    private async ensureRoundOneHeatEntries(heatId: string, config: any): Promise<void> {
        const eventId = Number.isFinite(Number(config?.event_id)) ? Number(config.event_id) : null;
        const division = String(config?.division ?? '').trim();
        const round = Number(config?.round);

        if (!eventId || !division || round !== 1) {
            return;
        }

        const { count, error: countError } = await this.supabase!
            .from('heat_entries')
            .select('position', { count: 'exact', head: true })
            .eq('heat_id', heatId);

        if (countError) throw countError;
        if ((count ?? 0) > 0) {
            return;
        }

        const { data: roundHeats, error: heatsError } = await this.supabase!
            .from('heats')
            .select('id, heat_number, heat_size, color_order')
            .eq('event_id', eventId)
            .ilike('division', division)
            .eq('round', 1)
            .order('heat_number', { ascending: true });

        if (heatsError) throw heatsError;
        if (!roundHeats?.length) {
            return;
        }

        const orderedHeats = roundHeats
            .filter((heat): heat is { id: string; heat_number: number; heat_size: number | null; color_order: string[] | null } =>
                Boolean(heat?.id) && Number.isFinite(Number(heat.heat_number))
            )
            .sort((a, b) => Number(a.heat_number) - Number(b.heat_number));

        const targetHeat = orderedHeats.find((heat) => ensureHeatId(heat.id) === heatId);
        if (!targetHeat) {
            return;
        }

        const { data: participantRows, error: participantsError } = await this.supabase!
            .from('participants')
            .select('id, event_id, category, seed, name, country, license')
            .eq('event_id', eventId)
            .ilike('category', division)
            .order('seed', { ascending: true });

        if (participantsError) throw participantsError;
        if (!participantRows?.length) {
            return;
        }

        const rawParticipants = (participantRows as ParticipantRow[])
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

        if (!rawParticipants.length) {
            return;
        }

        const participants = rawParticipants.map((participant, index) => ({
            id: participant.id,
            seed: participant.seed ?? index + 1,
            name: participant.name,
            country: participant.country,
            license: participant.license,
        } satisfies ParticipantSeed));

        const heatSizes = orderedHeats.map((heat) => Math.max(0, Number(heat.heat_size) || 0));
        const maxHeatSize = Math.max(...heatSizes, 0);
        if (maxHeatSize <= 0) {
            return;
        }

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
        if (!targetExpandedHeat) {
            return;
        }

        const colorOrder = Array.isArray(targetHeat.color_order) && targetHeat.color_order.length > 0
            ? targetHeat.color_order
            : getColorSet(Number(targetHeat.heat_size) || targetExpandedHeat.slots.length);

        const entryPayload = targetExpandedHeat.slots.map((participant, index) => ({
            heat_id: heatId,
            participant_id: participant?.id ?? null,
            position: index + 1,
            seed: participant?.seed ?? null,
            color: colorOrder[index] ?? null,
        }));

        const { error: insertError } = await this.supabase!
            .from('heat_entries')
            .upsert(entryPayload, { onConflict: 'heat_id,position' });

        if (insertError) throw insertError;

        logger.info('HeatRepository', 'Round-one heat entries reconstructed from participants', {
            heatId,
            eventId,
            division,
            entryCount: entryPayload.length,
        });
    }

    private async ensureEventLastConfigSnapshot(
        heatId: string,
        config: any,
        assignmentPayload: HeatJudgeAssignment[]
    ): Promise<void> {
        const heatMeta = await this.fetchHeatMetadata(heatId);
        if (!heatMeta?.event_id || !heatMeta.division || !heatMeta.round || !heatMeta.heat_number) {
            return;
        }

        const entries = await this.fetchHeatEntriesWithParticipantsRaw(heatId);
        const configSurfers = Array.isArray(config?.surfers)
            ? config.surfers.map((value: unknown) => String(value ?? '').trim()).filter(Boolean)
            : [];
        const configSurferNames = config?.surfer_names ?? config?.surferNames ?? {};
        const configSurferCountries = config?.surfer_countries ?? config?.surferCountries ?? {};

        const normalizedEntries = entries.map((entry) => {
            const color = String(entry.color ?? '').trim().toUpperCase();
            return {
                color,
                name: String(entry.participant?.name ?? '').trim(),
                country: String(entry.participant?.country ?? '').trim(),
            };
        });

        const surfers = normalizedEntries
            .map((entry) => entry.color)
            .filter(Boolean);

        const fallbackSurfers = surfers.length > 0 ? surfers : configSurfers;
        if (fallbackSurfers.length === 0) {
            return;
        }

        const surferNames = (fallbackSurfers as string[]).reduce((acc: Record<string, string>, color: string) => {
            const fromEntry = normalizedEntries.find((entry) => entry.color === color)?.name ?? '';
            const fromConfig = String(configSurferNames?.[color] ?? '').trim();
            const resolved = fromEntry || fromConfig;
            if (resolved) {
                acc[color] = resolved;
            }
            return acc;
        }, {} as Record<string, string>);

        const surferCountries = (fallbackSurfers as string[]).reduce((acc: Record<string, string>, color: string) => {
            const fromEntry = normalizedEntries.find((entry) => entry.color === color)?.country ?? '';
            const fromConfig = String(configSurferCountries?.[color] ?? '').trim();
            const resolved = fromEntry || fromConfig;
            if (resolved) {
                acc[color] = resolved;
            }
            return acc;
        }, {} as Record<string, string>);

        const judgePayload = assignmentPayload.map((assignment) => ({
            id: assignment.station,
            name: assignment.judge_name ?? assignment.station,
            identity_id: assignment.judge_id ?? null,
        }));

        const { error } = await this.supabase!.rpc('upsert_event_last_config', {
            p_event_id: heatMeta.event_id,
            p_event_name: String(config?.competition ?? heatMeta.competition ?? heatMeta.event_id).trim(),
            p_division: heatMeta.division,
            p_round: heatMeta.round,
            p_heat_number: heatMeta.heat_number,
            p_judges: judgePayload,
            p_surfers: fallbackSurfers,
            p_surfer_names: surferNames,
            p_surfer_countries: surferCountries,
        });

        if (error) throw error;

        logger.info('HeatRepository', 'Event last config snapshot enforced from heat data', {
            heatId,
            eventId: heatMeta.event_id,
            lineupCount: fallbackSurfers.length,
        });
    }
}

// Export singleton instance
export const heatRepository = new HeatRepository();
