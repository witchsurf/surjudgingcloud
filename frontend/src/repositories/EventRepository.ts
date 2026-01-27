/**
 * Event Repository
 * 
 * Manages all event-related database operations.
 * Handles events, configurations, snapshots, and divisions.
 */

import { BaseRepository } from './BaseRepository';
import type { AppConfig } from '../types';
import { logger } from '../lib/logger';

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

export interface EventConfigSnapshot {
    event_id: number;
    event_name: string;
    division: string;
    round: number;
    heat_number: number;
    judges: Array<{ id: string; name?: string }>;
    surfers?: string[];
    heat_size?: number;
    surferNames?: Record<string, string>;
    surferCountries?: Record<string, string>;
    eventDetails?: { organizer?: string; date?: string };
    updated_at: string;
}

export interface UpdateEventConfigRequest {
    eventId: number;
    config: AppConfig;
    divisions: string[];
    judges: Array<{ id: string; name?: string }>;
}

export interface SaveSnapshotRequest {
    eventId: number;
    eventName: string;
    division: string;
    round: number;
    heatNumber: number;
    judges: Array<{ id: string; name?: string }>;
    surfers?: string[];
    surferNames?: Record<string, string>;
    surferCountries?: Record<string, string>;
}

/**
 * Repository for managing events and configurations
 */
export class EventRepository extends BaseRepository {
    constructor() {
        super('events');
    }

    /**
     * Fetch all events
     */
    async fetchEvents(): Promise<EventSummary[]> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('events')
                    .select('id, name, organizer, start_date, end_date, categories, judges, config')
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (error) throw error;

                logger.info('EventRepository', 'Events fetched', { count: data?.length || 0 });
                return (data ?? []) as EventSummary[];
            },
            // No offline fallback for events list
            undefined,
            'fetchEvents'
        );
    }

    /**
     * Fetch a single event by ID
     */
    async fetchEvent(eventId: number): Promise<EventSummary | null> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('events')
                    .select('id, name, organizer, start_date, end_date, categories, judges, config')
                    .eq('id', eventId)
                    .maybeSingle();

                if (error) throw error;

                logger.info('EventRepository', 'Event fetched', { eventId });
                return data as EventSummary | null;
            },
            undefined,
            'fetchEvent'
        );
    }

    /**
     * Update event configuration
     */
    async updateEventConfiguration(request: UpdateEventConfigRequest): Promise<void> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const storedConfig: Partial<AppConfig> = {
                    ...request.config,
                    judgeNames: request.config.judgeNames,
                };

                const { error } = await this.supabase!
                    .from('events')
                    .update({
                        name: request.config.competition,
                        categories: request.divisions,
                        judges: request.judges,
                        config: storedConfig,
                    })
                    .eq('id', request.eventId);

                if (error) throw error;

                logger.info('EventRepository', 'Event configuration updated', { eventId: request.eventId });
            },
            undefined,
            'updateEventConfiguration'
        );
    }

    /**
     * Fetch event configuration snapshot
     */
    async fetchEventConfigSnapshot(eventId: number): Promise<EventConfigSnapshot | null> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                // Fetch snapshot
                const { data, error } = await this.supabase!
                    .from('event_last_config')
                    .select('event_id, event_name, division, round, heat_number, judges, updated_at')
                    .eq('event_id', eventId)
                    .maybeSingle();

                if (error) throw error;
                if (!data) return null;

                // Parse judges
                const judgesPayload = this.parseJudges(data.judges);

                // Fetch heat structure for surfer data
                const { surfers, heatSize, surferNames, surferCountries } =
                    await this.fetchHeatStructure(eventId, data.division, data.round, data.heat_number);

                // Fetch event details
                const eventDetails = await this.fetchEventDetails(eventId);

                return {
                    event_id: data.event_id,
                    event_name: data.event_name,
                    division: data.division,
                    round: data.round,
                    heat_number: data.heat_number,
                    judges: judgesPayload,
                    surfers,
                    heat_size: heatSize,
                    surferNames,
                    surferCountries,
                    eventDetails,
                    updated_at: data.updated_at,
                };
            },
            undefined,
            'fetchEventConfigSnapshot'
        );
    }

    /**
     * Save event configuration snapshot
     */
    async saveEventConfigSnapshot(request: SaveSnapshotRequest): Promise<void> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const judgePayload = request.judges.map((judge) => ({
                    id: judge.id,
                    name: judge.name ?? judge.id,
                }));

                const { error } = await this.supabase!.rpc('upsert_event_last_config', {
                    p_event_id: request.eventId,
                    p_event_name: request.eventName,
                    p_division: request.division,
                    p_round: request.round,
                    p_heat_number: request.heatNumber,
                    p_judges: judgePayload,
                    p_surfers: request.surfers || [],
                    p_surfer_names: request.surferNames || {},
                    p_surfer_countries: request.surferCountries || {}
                });

                if (error) throw error;

                logger.info('EventRepository', 'Event config snapshot saved', { eventId: request.eventId });
            },
            undefined,
            'saveEventConfigSnapshot'
        );
    }

    /**
     * Fetch distinct divisions for an event
     */
    async fetchDistinctDivisions(eventId?: number): Promise<string[]> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                // Try from view first
                let builder = this.supabase!
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
                    logger.info('EventRepository', 'Divisions fetched from view', { count: divisions.length });
                    return divisions;
                }

                // Fallback to participants table
                const fallback = await this.supabase!
                    .from('participants')
                    .select('division')
                    .eq('event_id', eventId)
                    .order('division', { ascending: true });

                if (fallback.error) throw fallback.error;

                const fallbackDivisions = Array.from(
                    new Set(
                        (fallback.data ?? [])
                            .map((row: { division: string | null }) => row.division ?? '')
                            .filter((value): value is string => Boolean(value))
                    )
                );

                logger.info('EventRepository', 'Divisions fetched from participants', { count: fallbackDivisions.length });
                return fallbackDivisions;
            },
            undefined,
            'fetchDistinctDivisions'
        );
    }

    /**
     * Fetch event ID by name
     */
    async fetchEventIdByName(eventName: string): Promise<number | null> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('events')
                    .select('id')
                    .ilike('name', eventName)
                    .maybeSingle();

                if (error) throw error;

                return data?.id ?? null;
            },
            undefined,
            'fetchEventIdByName'
        );
    }

    // ========== Private Helper Methods ==========

    private parseJudges(judgesData: any): Array<{ id: string; name: string }> {
        if (!Array.isArray(judgesData)) return [];

        return (judgesData as Array<{ id?: string; name?: string }>)
            .map((judge) => {
                if (typeof judge === 'string') {
                    return { id: judge, name: judge };
                }
                if (judge && typeof judge === 'object' && typeof judge.id === 'string') {
                    return { id: judge.id, name: judge.name ?? judge.id };
                }
                return null;
            })
            .filter((value): value is { id: string; name: string } => Boolean(value));
    }

    private async fetchHeatStructure(
        eventId: number,
        division: string,
        round: number,
        heatNumber: number
    ): Promise<{
        surfers?: string[];
        heatSize?: number;
        surferNames?: Record<string, string>;
        surferCountries?: Record<string, string>;
    }> {
        try {
            const { data: heatData } = await this.supabase!
                .from('heats')
                .select('id, heat_size, heat_entries(position, color, seed, participant:participants(name, country))')
                .eq('event_id', eventId)
                .eq('division', division)
                .eq('round', round)
                .eq('heat_number', heatNumber)
                .maybeSingle();

            if (!heatData) return {};

            const heatSize = heatData.heat_size ?? undefined;
            const entries = (heatData.heat_entries as any[] | null) || [];

            if (entries.length === 0) return { heatSize };

            const sortedEntries = entries
                .filter((entry: any) => entry.color)
                .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

            const surfers = sortedEntries
                .map((entry: any) => entry.color?.toString().toUpperCase() || '')
                .filter(Boolean);

            const surferNames: Record<string, string> = {};
            const surferCountries: Record<string, string> = {};

            sortedEntries.forEach((entry: any) => {
                const color = entry.color?.toString().toUpperCase();
                if (color && entry.participant) {
                    if (entry.participant.name) {
                        surferNames[color] = entry.participant.name;
                    }
                    if (entry.participant.country) {
                        surferCountries[color] = entry.participant.country;
                    }
                }
            });

            return { surfers, heatSize, surferNames, surferCountries };
        } catch (err) {
            logger.warn('EventRepository', 'Could not fetch heat structure', err);
            return {};
        }
    }

    private async fetchEventDetails(eventId: number): Promise<{ organizer?: string; date?: string } | undefined> {
        try {
            const { data: eventData } = await this.supabase!
                .from('events')
                .select('organizer, start_date')
                .eq('id', eventId)
                .maybeSingle();

            if (!eventData) return undefined;

            return {
                organizer: eventData.organizer,
                date: eventData.start_date ? new Date(eventData.start_date).toLocaleDateString('fr-FR') : undefined,
            };
        } catch (err) {
            logger.warn('EventRepository', 'Could not fetch event details', err);
            return undefined;
        }
    }
}

// Export singleton instance
export const eventRepository = new EventRepository();
