/**
 * Participant Repository
 * 
 * Manages participant/surfer database operations.
 */

import { BaseRepository } from './BaseRepository';
import type { ParsedParticipant } from '../utils/csv';
import type { ParticipantInput, ParticipantPatch, ParticipantRecord, ParticipantRepositoryContract } from './contracts';
import { deleteParticipant, fetchParticipants, updateParticipant, upsertParticipants } from '../api/modules/participants.api';

/**
 * Repository for managing participants
 */
export class ParticipantRepository extends BaseRepository implements ParticipantRepositoryContract {
    constructor() {
        super('participants');
    }

    /**
     * Fetch all participants for an event
     */
    async fetchParticipants(eventId: number): Promise<ParticipantRecord[]> {
        return this.listByEvent(eventId);
    }

    /**
     * Upsert multiple participants
     */
    async upsertParticipants(eventId: number, rows: ParsedParticipant[]): Promise<void> {
        return this.upsertMany(eventId, rows);
    }

    /**
     * Update a single participant
     */
    async updateParticipant(id: number, patch: Partial<ParsedParticipant>): Promise<void> {
        return this.update(id, patch);
    }

    /**
     * Delete a participant
     */
    async deleteParticipant(id: number): Promise<void> {
        return this.delete(id);
    }

    async listByEvent(eventId: number): Promise<ParticipantRecord[]> {
        const rows = await fetchParticipants(eventId);
        return rows.map((row) => ({
            id: row.id, eventId: row.event_id, category: row.category, seed: row.seed,
            name: row.name, country: row.country ?? null, license: row.license ?? null,
        }));
    }

    async upsertMany(eventId: number, rows: readonly ParticipantInput[]): Promise<void> {
        await upsertParticipants(eventId, rows.map((row) => ({ ...row })));
    }

    async update(id: number, patch: ParticipantPatch): Promise<void> {
        await updateParticipant(id, patch);
    }

    async delete(id: number): Promise<void> {
        await deleteParticipant(id);
    }
}

// Export singleton instance
export const participantRepository = new ParticipantRepository();
