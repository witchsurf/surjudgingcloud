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
        
        const payload = {
            heat_id: normalizedHeatId,
            config: config,
            updated_at: new Date().toISOString()
        };

        return this.execute(
            async () => {
                this.ensureSupabase();
                const { error } = await this.supabase!
                    .from('heat_configs')
                    .upsert(payload, { onConflict: 'heat_id' });

                if (error) throw error;
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
            },
            'saveHeatConfig'
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
                    .upsert(heatData, { onConflict: 'competition, division, round, heat_number' });

                if (error) throw error;
                logger.info('HeatRepository', 'Heat created online', { heat: heatData });
            },
            () => {
                logger.info('HeatRepository', 'Heat created offline', { heat: heatData });
                saveOffline({
                    table: 'heats',
                    action: 'insert',
                    payload: heatData,
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
}

// Export singleton instance
export const heatRepository = new HeatRepository();

