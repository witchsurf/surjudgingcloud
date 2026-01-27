/**
 * Heat Repository
 * 
 * Manages heat-related database operations.
 * Handles heat creation, status updates, entries, and sequences.
 */

import { BaseRepository } from './BaseRepository';
import { ensureHeatId } from '../utils/heat';
import { logger } from '../lib/logger';

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
                return (data || []) as HeatEntryWithParticipant[];
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
     * Update heat status
     */
    async updateHeatStatus(heatId: string, status: string): Promise<void> {
        const normalizedHeatId = ensureHeatId(heatId);

        return this.execute(
            async () => {
                this.ensureSupabase();

                const { error } = await this.supabase!
                    .from('heats')
                    .update({ status })
                    .eq('id', normalizedHeatId);

                if (error) throw error;

                logger.info('HeatRepository', 'Heat status updated', { heatId: normalizedHeatId, status });
            },
            undefined,
            'updateHeatStatus'
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
}

// Export singleton instance
export const heatRepository = new HeatRepository();
