import { useCallback } from 'react';
import { useConfigStore } from '../stores/configStore';
import { useJudgingStore } from '../stores/judgingStore';
import { scoreRepository } from '../repositories';
import { ensureHeatId } from '../utils/heat';
import type { Score, ScoreOverrideLog, OverrideReason } from '../types';

interface OverrideRequest {
    judgeId: string;
    judgeName: string;
    surfer: string;
    waveNumber: number;
    newScore: number;
    reason: OverrideReason;
    comment?: string;
}

export function useScoreManager() {
    const { config, configSaved } = useConfigStore();
    const { setScores, setOverrideLogs } = useJudgingStore();

    const handleScoreSubmit = useCallback(async (
        scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp' | 'synced'>,
        heatId: string
    ): Promise<Score | undefined> => {
        try {
            // Use ScoreRepository instead of useSupabaseSync
            const newScore = await scoreRepository.saveScore({
                heatId,
                competition: scoreData.competition || '',
                division: scoreData.division || '',
                round: scoreData.round ?? 0,
                judgeId: scoreData.judge_id,
                judgeName: scoreData.judge_name,
                surfer: scoreData.surfer,
                waveNumber: scoreData.wave_number,
                score: scoreData.score,
            });

            // Update local scores
            setScores(prev => [...prev, newScore]);

            console.log('✅ Score sauvé:', newScore);
            return newScore;
        } catch (error) {
            console.error('❌ Erreur sauvegarde score:', error);
            return undefined;
        }
    }, [setScores]);

    const handleScoreOverride = useCallback(async (request: OverrideRequest, heatId: string): Promise<ScoreOverrideLog | undefined> => {
        if (!configSaved || !config.competition) {
            console.warn('⚠️ Override ignoré: configuration non sauvegardée');
            return undefined;
        }

        try {
            // Use ScoreRepository instead of useSupabaseSync
            const result = await scoreRepository.overrideScore({
                heatId: heatId,
                competition: config.competition,
                division: config.division,
                round: config.round,
                judgeId: request.judgeId,
                judgeName: request.judgeName,
                surfer: request.surfer,
                waveNumber: request.waveNumber,
                newScore: request.newScore,
                reason: request.reason,
                comment: request.comment
            });

            const { updatedScore, log } = result;

            setScores(prev => {
                const matchIndex = prev.findIndex(
                    score =>
                        ensureHeatId(score.heat_id) === heatId &&
                        score.judge_id === request.judgeId &&
                        score.wave_number === request.waveNumber &&
                        score.surfer === request.surfer
                );
                if (matchIndex >= 0) {
                    const clone = [...prev];
                    clone[matchIndex] = updatedScore;
                    return clone;
                }
                return [...prev, updatedScore];
            });

            setOverrideLogs(prev => {
                const merged = [log, ...prev.filter(entry => entry.id !== log.id)];
                return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            });

            window.dispatchEvent(new CustomEvent('newScoreRealtime', { detail: updatedScore }));

            console.log('✅ Override appliqué:', {
                judge: request.judgeId,
                surfer: request.surfer,
                wave: request.waveNumber,
                newScore: request.newScore,
                reason: request.reason
            });

            return log;
        } catch (error) {
            console.error('❌ Erreur override score:', error);
            return undefined;
        }
    }, [config, configSaved, setScores, setOverrideLogs]);

    const handleScoreSync = useCallback(async (heatId: string) => {
        try {
            return await scoreRepository.syncScores(heatId);
        } catch (error) {
            console.error('❌ Erreur synchronisation manuelle:', error);
            throw error;
        }
    }, []);

    return {
        handleScoreSubmit,
        handleScoreOverride,
        handleScoreSync
    };
}
