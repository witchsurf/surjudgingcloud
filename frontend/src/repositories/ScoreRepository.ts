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

export interface SaveScoreRequest {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
    surfer: string;
    waveNumber: number;
    score: number;
}

export interface OverrideScoreRequest {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
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
            heat_id: normalizedHeatId,
            competition: request.competition,
            division: request.division,
            round: request.round,
            judge_id: request.judgeId,
            judge_name: request.judgeName,
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

                const { error } = await this.supabase!
                    .from('scores')
                    .upsert({
                        id: newScore.id,
                        heat_id: newScore.heat_id,
                        competition: newScore.competition,
                        division: newScore.division,
                        round: newScore.round,
                        judge_id: newScore.judge_id,
                        judge_name: newScore.judge_name,
                        surfer: newScore.surfer,
                        wave_number: newScore.wave_number,
                        score: newScore.score,
                        timestamp: newScore.timestamp,
                        created_at: newScore.created_at
                    }, { onConflict: 'id' });

                if (error) {
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

                const scores = (data || []) as Score[];
                logger.info('ScoreRepository', 'Scores fetched online', { count: scores.length });
                return scores;
            },
            // Offline fallback
            () => {
                const scores = this.getScoresFromLocalStorage().filter(
                    score => heatIds.includes(ensureHeatId(score.heat_id))
                );
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

        // Find existing score in localStorage
        const localScores = this.getScoresFromLocalStorage();
        const matchIndex = localScores.findIndex(
            score =>
                ensureHeatId(score.heat_id) === normalizedHeatId &&
                score.judge_id === request.judgeId &&
                score.wave_number === request.waveNumber &&
                score.surfer === request.surfer
        );

        const existingScore = matchIndex >= 0 ? localScores[matchIndex] : undefined;
        const scoreId = existingScore?.id ?? this.generateId();

        const updatedScore: Score = {
            id: scoreId,
            heat_id: normalizedHeatId,
            competition: request.competition,
            division: request.division,
            round: request.round,
            judge_id: request.judgeId,
            judge_name: request.judgeName,
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
            score_id: scoreId!,
            judge_id: request.judgeId,
            judge_name: request.judgeName,
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

                // Save score
                const { error: scoreError } = await this.supabase!
                    .from('scores')
                    .upsert({
                        id: scoreId,
                        heat_id: normalizedHeatId,
                        competition: request.competition,
                        division: request.division,
                        round: request.round,
                        judge_id: request.judgeId,
                        judge_name: request.judgeName,
                        surfer: request.surfer,
                        wave_number: request.waveNumber,
                        score: request.newScore,
                        timestamp: updatedScore.timestamp,
                        created_at: updatedScore.created_at
                    }, { onConflict: 'id' });

                if (scoreError) throw scoreError;

                // Save override log
                const { error: logError } = await this.supabase!
                    .from('score_overrides')
                    .upsert({
                        id: overrideLog.id,
                        heat_id: overrideLog.heat_id,
                        score_id: overrideLog.score_id,
                        judge_id: overrideLog.judge_id,
                        judge_name: overrideLog.judge_name,
                        surfer: overrideLog.surfer,
                        wave_number: overrideLog.wave_number,
                        previous_score: overrideLog.previous_score,
                        new_score: overrideLog.new_score,
                        reason: overrideLog.reason,
                        comment: overrideLog.comment,
                        overridden_by: overrideLog.overridden_by,
                        overridden_by_name: overrideLog.overridden_by_name,
                        created_at: overrideLog.created_at
                    }, { onConflict: 'id' });

                if (logError) throw logError;

                // Update local storage
                this.updateScoreInLocalStorage(updatedScore, matchIndex);
                this.saveOverrideLogToLocalStorage(overrideLog);

                logger.info('ScoreRepository', 'Score overridden online', { scoreId });

                return { updatedScore, previousScore: existingScore, log: overrideLog };
            },
            // Offline fallback
            () => {
                this.updateScoreInLocalStorage(updatedScore, matchIndex);
                this.saveOverrideLogToLocalStorage(overrideLog);

                logger.info('ScoreRepository', 'Score overridden offline', { scoreId });

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
            
            // Get context from localStorage or fall back to score's own competition
            const eventIdRaw = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
            const globalEventId = eventIdRaw ? parseInt(eventIdRaw, 10) : undefined;

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
                event_id: globalEventId || s.event_id || null
            })));

            const { error } = await this.supabase!
                .from('scores')
                .upsert(dedupedScores.map(s => ({
                    id: s.id,
                    heat_id: s.heat_id,
                    event_id: globalEventId || s.event_id || null, // Use score's own event_id if global is missing
                    competition: s.competition || 'Competition',
                    division: s.division || 'OPEN',
                    round: s.round || 1,
                    judge_id: s.judge_id,
                    judge_name: s.judge_name,
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
            // Async dual-write synced status to IndexedDB
            saveScoresBatchIDB(updatedScores.filter(s => ensureHeatId(s.heat_id) === normalizedHeatId)).catch(() => {});

            logger.info('ScoreRepository', 'Manual sync successful', { count: dedupedScores.length });
            return { success: dedupedScores.length, failed: 0 };
        } catch (error) {
            logger.error('ScoreRepository', 'Manual sync failed', error);
            throw new Error(this.errorToMessage(error));
        }
    }

    // ========== Private Helper Methods ==========

    private saveScoreToLocalStorage(score: Score): void {
        const scores = this.getScoresFromLocalStorage();
        scores.push(score);
        localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(scores));
        // Async dual-write to IndexedDB (fire-and-forget)
        saveScoreIDB(score).catch(() => {});
    }

    private updateScoreInLocalStorage(score: Score, matchIndex: number): void {
        const scores = this.getScoresFromLocalStorage();
        if (matchIndex >= 0) {
            scores[matchIndex] = score;
        } else {
            scores.push(score);
        }
        localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(scores));
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
