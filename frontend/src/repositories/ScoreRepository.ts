/**
 * Score Repository
 * 
 * Manages all score-related database operations.
 * Handles score submission, overrides, and syncing.
 */

import { BaseRepository } from './BaseRepository';
import type { Score, ScoreOverrideLog, OverrideReason } from '../types';
import { ensureHeatId } from '../utils/heat';
import { logger } from '../lib/logger';
import { saveScoreIDB, saveScoresBatchIDB } from '../lib/idbStorage';
import { canonicalizeScores, recordScoreOverrideSecure, toParsedScore, type RawScoreRow } from '../api/modules/scoring.api';
import { fetchHeatMetadata } from '../api/supabaseClient';

export interface SaveScoreRequest {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
    judgeStation?: string;
    judgeIdentityId?: string;
    surfer: string;
    waveNumber: number;
    score: number;
    eventId?: number | null;
}

export interface OverrideScoreRequest {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
    judgeStation?: string;
    judgeIdentityId?: string;
    surfer: string;
    waveNumber: number;
    newScore: number;
    reason: OverrideReason;
    comment?: string;
}

export interface OverrideResult {
    updatedScore: Score;
    previousScore: Score | undefined;
    log: ScoreOverrideLog;
}

const SCORES_STORAGE_KEY = 'surfJudgingScores';
const OVERRIDE_LOGS_KEY = 'surfJudgingOverrideLogs';

/**
 * Repository for managing scores and overrides
 */
export class ScoreRepository extends BaseRepository {
    constructor() {
        super('scores');
    }

    /**
     * Extract a readable shape from Supabase/PostgREST errors for actionable logs.
     */
    private formatDbError(error: unknown): Record<string, unknown> {
        if (!error || typeof error !== 'object') {
            return { raw: error };
        }

        const candidate = error as {
            code?: string;
            message?: string;
            details?: string;
            hint?: string;
            status?: number;
            statusCode?: number;
        };

        return {
            code: candidate.code,
            message: candidate.message,
            details: candidate.details,
            hint: candidate.hint,
            status: candidate.status ?? candidate.statusCode,
            raw: error
        };
    }

    private errorToMessage(error: unknown): string {
        if (error instanceof Error && error.message) return error.message;
        if (error && typeof error === 'object') {
            const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
            const parts = [
                candidate.code ? `code=${candidate.code}` : '',
                candidate.message || '',
                candidate.details ? `details=${candidate.details}` : '',
                candidate.hint ? `hint=${candidate.hint}` : '',
            ].filter(Boolean);
            if (parts.length) return parts.join(' | ');
        }
        return 'Erreur de synchronisation inconnue';
    }

    private parseHeatNumberFromHeatId(heatId: string): number {
        const match = ensureHeatId(heatId).match(/_h(\d+)$/i);
        if (!match) return 1;
        const value = Number.parseInt(match[1], 10);
        return Number.isFinite(value) && value > 0 ? value : 1;
    }

    private isUpsertScoreSecureUnavailable(error: unknown): boolean {
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
            text.includes('upsert_score_secure')
            && (
                text.includes('pgrst202')
                || text.includes('schema cache')
                || text.includes('could not find the function')
                || text.includes('42883')
            )
        );
    }

    private async upsertScoreSecure(score: Score): Promise<void> {
        this.ensureSupabase();

        const { error } = await this.supabase!.rpc('upsert_score_secure', {
            p_id: score.id,
            p_event_id: score.event_id ?? null,
            p_heat_id: score.heat_id,
            p_competition: score.competition,
            p_division: score.division,
            p_round: score.round,
            p_judge_id: score.judge_id,
            p_judge_name: score.judge_name,
            p_judge_station: score.judge_station || score.judge_id,
            p_judge_identity_id: score.judge_identity_id ?? null,
            p_surfer: score.surfer,
            p_wave_number: score.wave_number,
            p_score: score.score,
            p_timestamp: score.timestamp || new Date().toISOString(),
            p_created_at: score.created_at || new Date().toISOString(),
        });

        if (error && !this.isUpsertScoreSecureUnavailable(error)) {
            throw error;
        }

        if (error) {
            const { error: fallbackError } = await this.supabase!
                .from('scores')
                .upsert({
                    id: score.id,
                    event_id: score.event_id,
                    heat_id: score.heat_id,
                    competition: score.competition,
                    division: score.division,
                    round: score.round,
                    judge_id: score.judge_id,
                    judge_name: score.judge_name,
                    judge_station: score.judge_station || score.judge_id,
                    judge_identity_id: score.judge_identity_id,
                    surfer: score.surfer,
                    wave_number: score.wave_number,
                    score: score.score,
                    timestamp: score.timestamp,
                    created_at: score.created_at
                }, { onConflict: 'id' });

            if (fallbackError) throw fallbackError;
        }
    }

    private async resolveEventIdForHeat(
        heatId: string,
        fallbackEventId?: number | null
    ): Promise<number | null> {
        const normalizedHeatId = ensureHeatId(heatId);

        try {
            const metadata = await fetchHeatMetadata(normalizedHeatId);
            if (metadata?.event_id != null) {
                return Number(metadata.event_id);
            }
        } catch (error) {
            logger.warn('ScoreRepository', 'Failed to resolve event_id from heat metadata', {
                heatId: normalizedHeatId,
                fallbackEventId,
                error,
            });
        }

        if (fallbackEventId != null && Number.isFinite(Number(fallbackEventId))) {
            return Number(fallbackEventId);
        }

        return null;
    }

    private async ensureHeatRowsExist(scores: Array<{
        heat_id: string;
        competition?: string;
        division?: string;
        round?: number;
        event_id?: number | null;
    }>): Promise<void> {
        this.ensureSupabase();
        if (!scores.length) return;

        const byHeatId = new Map<string, {
            heat_id: string;
            competition?: string;
            division?: string;
            round?: number;
            event_id?: number | null;
        }>();

        scores.forEach((score) => {
            const normalized = ensureHeatId(score.heat_id);
            if (!byHeatId.has(normalized)) {
                byHeatId.set(normalized, { ...score, heat_id: normalized });
            }
        });

        const heatIds = Array.from(byHeatId.keys());
        const { data: existing, error: existingError } = await this.supabase!
            .from('heats')
            .select('id')
            .in('id', heatIds);

        if (existingError) throw existingError;

        const existingIds = new Set((existing || []).map((row) => row.id));
        const missing = heatIds.filter((id) => !existingIds.has(id));
        if (!missing.length) return;

        const payload = missing.map((heatId) => {
            const source = byHeatId.get(heatId)!;
            return {
                id: heatId,
                event_id: source.event_id ?? null,
                competition: source.competition || 'Competition',
                division: source.division || 'OPEN',
                round: source.round || 1,
                heat_number: this.parseHeatNumberFromHeatId(heatId),
                status: 'open',
                created_at: new Date().toISOString(),
            };
        });

        const { error: insertError } = await this.supabase!
            .from('heats')
            .upsert(payload, { onConflict: 'id' });

        if (insertError) throw insertError;

        logger.warn('ScoreRepository', 'Missing heats auto-created before score sync', { count: payload.length, heatIds: missing });
    }

    /**
     * Save a new score
     */
    async saveScore(request: SaveScoreRequest): Promise<Score> {
        const normalizedHeatId = ensureHeatId(request.heatId);

        const newScore: Score = {
            id: this.generateId(),
            event_id: request.eventId ?? undefined,
            heat_id: normalizedHeatId,
            competition: request.competition,
            division: request.division,
            round: request.round,
            judge_id: request.judgeId,
            judge_name: request.judgeName,
            judge_station: request.judgeStation || request.judgeId,
            judge_identity_id: request.judgeIdentityId,
            surfer: request.surfer,
            wave_number: request.waveNumber,
            score: request.score,
            timestamp: this.now(),
            created_at: this.now(),
            synced: false
        };

        return this.execute(
            // Online operation
            async () => {
                this.ensureSupabase();

                await this.ensureHeatRowsExist([{
                    heat_id: newScore.heat_id,
                    competition: newScore.competition,
                    division: newScore.division,
                    round: newScore.round,
                    event_id: newScore.event_id ?? null
                }]);

                try {
                    await this.upsertScoreSecure(newScore);
                } catch (error) {
                    logger.error('ScoreRepository', 'saveScore DB error details', this.formatDbError(error));
                    throw error;
                }

                // Mark as synced
                newScore.synced = true;
                this.saveScoreToLocalStorage(newScore);

                logger.info('ScoreRepository', 'Score saved online', { scoreId: newScore.id });
                return newScore;
            },
            // Offline fallback
            () => {
                // BUG FIX: Mark as NOT synced so it can be picked up by sync worker later
                newScore.synced = false;
                this.saveScoreToLocalStorage(newScore);
                logger.info('ScoreRepository', 'Score saved offline (pending sync)', { scoreId: newScore.id });
                return newScore;
            },
            'saveScore'
        );
    }

    /**
     * Fetch all scores for a heat
     */
    async fetchScores(heatId: string, legacyHeatId?: string): Promise<Score[]> {
        const normalizedHeatId = ensureHeatId(heatId);
        const heatIds = [normalizedHeatId];
        if (legacyHeatId) {
            heatIds.push(ensureHeatId(legacyHeatId));
        }

        return this.execute(
            // Online operation
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('scores')
                    .select('*')
                    .in('heat_id', heatIds)
                    .order('created_at', { ascending: true });

                if (error) throw error;

                const scores = canonicalizeScores(((data || []) as RawScoreRow[]).map(toParsedScore));
                logger.info('ScoreRepository', 'Scores fetched online', { count: scores.length });
                return scores;
            },
            // Offline fallback
            () => {
                const scores = canonicalizeScores(this.getScoresFromLocalStorage().filter(
                    score => heatIds.includes(ensureHeatId(score.heat_id))
                ));
                logger.info('ScoreRepository', 'Scores fetched offline', { count: scores.length });
                return scores;
            },
            'fetchScores'
        );
    }

    /**
     * Override an existing score
     */
    async overrideScore(request: OverrideScoreRequest): Promise<OverrideResult> {
        const normalizedHeatId = ensureHeatId(request.heatId);
        const now = new Date();

        // Find the latest logical score in localStorage without destroying history.
        const localScores = this.getScoresFromLocalStorage();
        const matchingScores = localScores.filter(
                score =>
                ensureHeatId(score.heat_id) === normalizedHeatId &&
                (score.judge_station || score.judge_id) === (request.judgeStation || request.judgeId) &&
                score.wave_number === request.waveNumber &&
                score.surfer === request.surfer
        );
        const existingScore = matchingScores.sort(
            (a, b) => new Date(b.timestamp || b.created_at || 0).getTime() - new Date(a.timestamp || a.created_at || 0).getTime()
        )[0];
        const updatedScoreId = this.generateId();
        const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
        const derivedEventId = eventIdRaw ? parseInt(eventIdRaw, 10) : undefined;

        const updatedScore: Score = {
            id: updatedScoreId,
            event_id: existingScore?.event_id ?? derivedEventId,
            heat_id: normalizedHeatId,
            competition: request.competition,
            division: request.division,
            round: request.round,
            judge_id: request.judgeId,
            judge_name: request.judgeName,
            judge_station: request.judgeStation || request.judgeId,
            judge_identity_id: request.judgeIdentityId,
            surfer: request.surfer,
            wave_number: request.waveNumber,
            score: request.newScore,
            timestamp: now.toISOString(),
            created_at: existingScore?.created_at ?? now.toISOString(),
            synced: this.isOnline
        };

        const overrideLog: ScoreOverrideLog = {
            id: this.generateId(),
            heat_id: normalizedHeatId,
            score_id: existingScore?.id ?? updatedScoreId,
            judge_id: request.judgeId,
            judge_name: request.judgeName,
            judge_station: request.judgeStation || request.judgeId,
            judge_identity_id: request.judgeIdentityId,
            surfer: request.surfer,
            wave_number: request.waveNumber,
            previous_score: existingScore ? existingScore.score : null,
            new_score: request.newScore,
            reason: request.reason,
            comment: request.comment,
            overridden_by: 'chief_judge',
            overridden_by_name: 'Chef Judge',
            created_at: now.toISOString()
        };

        return this.execute(
            // Online operation
            async () => {
                this.ensureSupabase();
                const resolvedEventId = await this.resolveEventIdForHeat(
                    normalizedHeatId,
                    existingScore?.event_id ?? derivedEventId ?? null
                );

                // Save score
                await this.upsertScoreSecure({
                    ...updatedScore,
                    event_id: resolvedEventId ?? updatedScore.event_id,
                });

                // Save override log
                await recordScoreOverrideSecure({
                    id: overrideLog.id,
                    heat_id: overrideLog.heat_id,
                    score_id: overrideLog.score_id,
                    judge_id: overrideLog.judge_id,
                    judge_name: overrideLog.judge_name,
                    judge_station: overrideLog.judge_station,
                    judge_identity_id: overrideLog.judge_identity_id,
                    surfer: overrideLog.surfer,
                    wave_number: overrideLog.wave_number,
                    previous_score: overrideLog.previous_score,
                    new_score: overrideLog.new_score,
                    reason: overrideLog.reason,
                    comment: overrideLog.comment,
                    overridden_by: overrideLog.overridden_by,
                    overridden_by_name: overrideLog.overridden_by_name,
                    created_at: overrideLog.created_at,
                });

                // Update local storage
                this.saveScoreToLocalStorage(updatedScore);
                this.saveOverrideLogToLocalStorage(overrideLog);

                logger.info('ScoreRepository', 'Score overridden online (append-only)', { scoreId: updatedScore.id, previousScoreId: existingScore?.id });

                return { updatedScore, previousScore: existingScore, log: overrideLog };
            },
            // Offline fallback
            () => {
                this.saveScoreToLocalStorage(updatedScore);
                this.saveOverrideLogToLocalStorage(overrideLog);

                logger.info('ScoreRepository', 'Score overridden offline (append-only)', { scoreId: updatedScore.id, previousScoreId: existingScore?.id });

                return { updatedScore, previousScore: existingScore, log: overrideLog };
            },
            'overrideScore'
        );
    }

    /**
     * Fetch override logs for a heat
     */
    async fetchOverrideLogs(heatId: string): Promise<ScoreOverrideLog[]> {
        const normalizedHeatId = ensureHeatId(heatId);

        return this.execute(
            // Online operation
            async () => {
                this.ensureSupabase();

                const { data, error } = await this.supabase!
                    .from('score_overrides')
                    .select('*')
                    .eq('heat_id', normalizedHeatId)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                const logs = (data || []) as ScoreOverrideLog[];
                logger.info('ScoreRepository', 'Override logs fetched online', { count: logs.length });
                return logs;
            },
            // Offline fallback
            () => {
                const logs = this.getOverrideLogsFromLocalStorage().filter(
                    log => log.heat_id === normalizedHeatId
                );
                logger.info('ScoreRepository', 'Override logs fetched offline', { count: logs.length });
                return logs;
            },
            'fetchOverrideLogs'
        );
    }

    /**
     * Synchronize all local scores for a specific heat to Supabase.
     * This is used for manual recovery if scores are in localStorage but not on server.
     */
    async syncScores(heatId: string): Promise<{ success: number; failed: number }> {
        const normalizedHeatId = ensureHeatId(heatId);
        
        if (!this.isOnline) {
            throw new Error('Impossible de synchroniser : vous êtes hors ligne ou Supabase n\'est pas configuré.');
        }

        const scores = this.getScoresFromLocalStorage().filter(
            s => ensureHeatId(s.heat_id) === normalizedHeatId
        );

        if (scores.length === 0) return { success: 0, failed: 0 };

        logger.info('ScoreRepository', `Manual sync triggered for heat ${normalizedHeatId}`, { total: scores.length });

        try {
            this.ensureSupabase();

            const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
            const globalEventId = eventIdRaw ? parseInt(eventIdRaw, 10) : undefined;
            const heatEventId = await this.resolveEventIdForHeat(normalizedHeatId, globalEventId ?? null);

            // Avoid ON CONFLICT batch cardinality errors when local storage contains duplicated ids.
            const dedupedScores = Array.from(
                new Map(scores.map(score => [score.id, score])).values()
            );

            if (dedupedScores.length !== scores.length) {
                logger.warn('ScoreRepository', 'Duplicate local score IDs detected before manual sync', {
                    total: scores.length,
                    deduped: dedupedScores.length
                });
            }

            await this.ensureHeatRowsExist(dedupedScores.map((s) => ({
                heat_id: s.heat_id,
                competition: s.competition,
                division: s.division,
                round: s.round,
                event_id: heatEventId ?? s.event_id ?? globalEventId ?? null
            })));

            const { error } = await this.supabase!
                .from('scores')
                .upsert(dedupedScores.map(s => ({
                    id: s.id,
                    heat_id: s.heat_id,
                    event_id: heatEventId ?? s.event_id ?? globalEventId ?? null,
                    competition: s.competition || 'Competition',
                    division: s.division || 'OPEN',
                    round: s.round || 1,
                    judge_id: s.judge_id,
                    judge_name: s.judge_name,
                    judge_station: s.judge_station || s.judge_id,
                    judge_identity_id: s.judge_identity_id || null,
                    surfer: s.surfer,
                    wave_number: s.wave_number,
                    score: s.score,
                    timestamp: s.timestamp || new Date().toISOString(),
                    created_at: s.created_at || new Date().toISOString()
                })), { onConflict: 'id' });

            if (error) {
                logger.error('ScoreRepository', 'syncScores DB error details', this.formatDbError(error));
                throw error;
            }

            // Mark all as synced in local storage
            const allLocalScores = this.getScoresFromLocalStorage();
            const updatedScores = allLocalScores.map(s => {
                if (ensureHeatId(s.heat_id) === normalizedHeatId) {
                    return { ...s, synced: true };
                }
                return s;
            });
            localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(updatedScores));
            window.dispatchEvent(new CustomEvent('localScoresUpdated'));
            // Async dual-write synced status to IndexedDB
            saveScoresBatchIDB(updatedScores.filter(s => ensureHeatId(s.heat_id) === normalizedHeatId)).catch(() => {});

            logger.info('ScoreRepository', 'Manual sync successful', { count: dedupedScores.length });
            return { success: dedupedScores.length, failed: 0 };
        } catch (error) {
            logger.error('ScoreRepository', 'Manual sync failed', error);
            throw new Error(this.errorToMessage(error));
        }
    }

    /**
     * Synchronize all pending local scores grouped by heat.
     * Uses the same per-heat sync path as the manual recovery button.
     */
    async syncPendingScores(): Promise<{ success: number; failed: number; heats: number }> {
        const pendingHeatIds = Array.from(
            new Set(
                this.getScoresFromLocalStorage()
                    .filter((score) => !score.synced)
                    .map((score) => ensureHeatId(score.heat_id))
            )
        );

        if (pendingHeatIds.length === 0) {
            return { success: 0, failed: 0, heats: 0 };
        }

        let success = 0;
        let failed = 0;

        for (const heatId of pendingHeatIds) {
            try {
                const result = await this.syncScores(heatId);
                success += result.success;
                failed += result.failed;
            } catch (error) {
                failed += this.getScoresFromLocalStorage().filter(
                    (score) => !score.synced && ensureHeatId(score.heat_id) === heatId
                ).length;
                logger.error('ScoreRepository', 'Pending heat sync failed', { heatId, error });
            }
        }

        return { success, failed, heats: pendingHeatIds.length };
    }

    // ========== Private Helper Methods ==========

    private saveScoreToLocalStorage(score: Score): void {
        const scores = this.getScoresFromLocalStorage();
        // Upsert by ID to prevent unbounded growth over long events
        const existingIndex = score.id ? scores.findIndex((s) => s.id === score.id) : -1;
        if (existingIndex >= 0) {
            scores[existingIndex] = score;
        } else {
            scores.push(score);
        }
        localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(scores));
        window.dispatchEvent(new CustomEvent('localScoresUpdated'));
        // Async dual-write to IndexedDB (fire-and-forget)
        saveScoreIDB(score).catch(() => {});
    }



    private getScoresFromLocalStorage(): Score[] {
        try {
            const raw = localStorage.getItem(SCORES_STORAGE_KEY);
            if (!raw) return [];
            return JSON.parse(raw) as Score[];
        } catch (error) {
            logger.error('ScoreRepository', 'Failed to read scores from localStorage', error);
            return [];
        }
    }

    private saveOverrideLogToLocalStorage(log: ScoreOverrideLog): void {
        const logs = this.getOverrideLogsFromLocalStorage();
        logs.unshift(log); // Add to beginning
        localStorage.setItem(OVERRIDE_LOGS_KEY, JSON.stringify(logs));
    }

    private getOverrideLogsFromLocalStorage(): ScoreOverrideLog[] {
        try {
            const raw = localStorage.getItem(OVERRIDE_LOGS_KEY);
            if (!raw) return [];
            return JSON.parse(raw) as ScoreOverrideLog[];
        } catch (error) {
            logger.error('ScoreRepository', 'Failed to read override logs from localStorage', error);
            return [];
        }
    }
}

// Export singleton instance
export const scoreRepository = new ScoreRepository();
