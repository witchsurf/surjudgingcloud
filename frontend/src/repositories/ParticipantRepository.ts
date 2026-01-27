/**
 * Participant Repository
 * 
 * Manages participant/surfer database operations.
 */

import { BaseRepository } from './BaseRepository';
import type { ParsedParticipant } from '../utils/csv';
import { logger } from '../lib/logger';

export interface ParticipantRecord extends ParsedParticipant {
    id: number;
    event_id: number;
}

/**
 * Repository for managing participants
 */
export class ParticipantRepository extends BaseRepository {
    constructor() {
        super('participants');
    }

    /**
     * Fetch all participants for an event
     */
    async fetchParticipants(eventId: number): Promise<ParticipantRecord[]> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('participants')
                    .select('id, event_id, category, seed, name, country, license')
                    .eq('event_id', eventId)
                    .order('category', { ascending: true })
                    .order('seed', { ascending: true });

                if (error) throw error;

                logger.info('ParticipantRepository', 'Participants fetched', { count: data?.length || 0 });
                return (data ?? []) as ParticipantRecord[];
            },
            undefined,
            'fetchParticipants'
        );
    }

    /**
     * Upsert multiple participants
     */
    async upsertParticipants(eventId: number, rows: ParsedParticipant[]): Promise<void> {
        if (!rows.length) return;

        return this.execute(
            async () => {
                this.ensureSupabase();

                const payload = rows.map((row) => ({
                    event_id: eventId,
                    category: row.category,
                    seed: row.seed,
                    name: row.name,
                    country: row.country ?? null,
                    license: row.license ?? null,
                }));

                const { error } = await this.supabase!
                    .from('participants')
                    .upsert(payload, { onConflict: 'event_id,category,seed' });

                if (error) throw error;

                logger.info('ParticipantRepository', 'Participants upserted', { count: rows.length });
            },
            undefined,
            'upsertParticipants'
        );
    }

    /**
     * Update a single participant
     */
    async updateParticipant(id: number, patch: Partial<ParsedParticipant>): Promise<void> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { error } = await this.supabase!
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

                logger.info('ParticipantRepository', 'Participant updated', { participantId: id });
            },
            undefined,
            'updateParticipant'
        );
    }

    /**
     * Delete a participant
     */
    async deleteParticipant(id: number): Promise<void> {
        return this.execute(
            async () => {
                this.ensureSupabase();

                const { error } = await this.supabase!
                    .from('participants')
                    .delete()
                    .eq('id', id);

                if (error) throw error;

                logger.info('ParticipantRepository', 'Participant deleted', { participantId: id });
            },
            undefined,
            'deleteParticipant'
        );
    }
}

// Export singleton instance
export const participantRepository = new ParticipantRepository();
