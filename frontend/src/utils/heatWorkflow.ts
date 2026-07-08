import { eventRepository } from '../repositories';
import { fetchHeatMetadata } from '../api/supabaseClient';
import { ensureHeatId } from './heat';
import { getHeatIdentifiers } from './heat';
import type { AppConfig } from '../types';

export function getNextHeatSyncTarget(config: AppConfig, advanced: boolean): string | null {
    if (!advanced) return null;

    return getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
    ).normalized;
}

type ResolveEventIdInput = {
    activeEventId?: number | null;
    competition?: string | null;
    heatId?: string | null;
};

export async function resolveEventIdForHeat(input: ResolveEventIdInput): Promise<number | null> {
    if (Number.isFinite(input.activeEventId) && (input.activeEventId ?? 0) > 0) {
        return Number(input.activeEventId);
    }

    if (typeof window !== 'undefined') {
        try {
            const persistedEventIdRaw = window.localStorage.getItem('surfJudgingActiveEventId') || window.localStorage.getItem('eventId');
            const persistedEventId = persistedEventIdRaw ? Number(persistedEventIdRaw) : NaN;
            if (Number.isFinite(persistedEventId) && persistedEventId > 0) {
                return persistedEventId;
            }
        } catch {
            // Ignore storage access failures and keep falling back.
        }
    }

    const normalizedHeatId = input.heatId ? ensureHeatId(input.heatId) : '';
    if (normalizedHeatId) {
        try {
            const metadata = await fetchHeatMetadata(normalizedHeatId);
            if (metadata?.event_id) {
                return metadata.event_id;
            }
        } catch {
            // Ignore metadata lookup errors and keep falling back.
        }
    }

    const competition = (input.competition || '').trim();
    if (competition) {
        try {
            return await eventRepository.fetchEventIdByName(competition);
        } catch {
            return null;
        }
    }

    return null;
}
