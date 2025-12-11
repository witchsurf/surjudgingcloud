import { useCallback } from 'react';
import { useConfig } from '../contexts/ConfigContext';
import { useJudging } from '../contexts/JudgingContext';
import { useSupabaseSync } from './useSupabaseSync';
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
    const { config, configSaved } = useConfig();
    const { setScores, setOverrideLogs } = useJudging();
    const { saveScore, overrideScore } = useSupabaseSync();



    // Helper to get the *actual* current heat ID (including competition/round/etc if needed)
    // In App.tsx it was: ensureHeatId(currentHeatId) where currentHeatId was derived from config.
    // We should probably pass heatId as argument or derive it from config same as App.tsx.
    // For now, let's assume the component calling this knows the heat ID or we derive it from config.

    const handleScoreSubmit = useCallback(async (
        scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>,
        heatId: string
    ): Promise<Score | undefined> => {
        try {
            const newScore = await saveScore(scoreData, heatId);

            // Update local scores
            setScores(prev => [...prev, newScore]);

            console.log('✅ Score sauvé:', newScore);
            return newScore;
        } catch (error) {
            console.error('❌ Erreur sauvegarde score:', error);
            return undefined;
        }
    }, [saveScore, setScores]);

    const handleScoreOverride = useCallback(async (request: OverrideRequest, heatId: string): Promise<ScoreOverrideLog | undefined> => {
        if (!configSaved || !config.competition) {
            console.warn('⚠️ Override ignoré: configuration non sauvegardée');
            return undefined;
        }

        try {
            const { updatedScore, log } = await overrideScore({
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
    }, [config, configSaved, overrideScore, setScores, setOverrideLogs]);

    return {
        handleScoreSubmit,
        handleScoreOverride
    };
}
