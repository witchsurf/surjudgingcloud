import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { Score, HeatTimer, ScoreOverrideLog } from '../types';
import { DEFAULT_TIMER_STATE } from '../utils/constants';

interface JudgingContextType {
    scores: Score[];
    setScores: React.Dispatch<React.SetStateAction<Score[]>>;
    timer: HeatTimer;
    setTimer: React.Dispatch<React.SetStateAction<HeatTimer>>;
    heatStatus: 'waiting' | 'running' | 'paused' | 'finished';
    setHeatStatus: React.Dispatch<React.SetStateAction<'waiting' | 'running' | 'paused' | 'finished'>>;
    overrideLogs: ScoreOverrideLog[];
    setOverrideLogs: React.Dispatch<React.SetStateAction<ScoreOverrideLog[]>>;
    judgeWorkCount: Record<string, number>;
    setJudgeWorkCount: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}

const JudgingContext = createContext<JudgingContextType | undefined>(undefined);

export function JudgingProvider({ children }: { children: ReactNode }) {
    const [scores, setScores] = useState<Score[]>([]);
    const [timer, setTimer] = useState<HeatTimer>(DEFAULT_TIMER_STATE);
    const [heatStatus, setHeatStatus] = useState<'waiting' | 'running' | 'paused' | 'finished'>('waiting');
    const [overrideLogs, setOverrideLogs] = useState<ScoreOverrideLog[]>([]);
    const [judgeWorkCount, setJudgeWorkCount] = useState<Record<string, number>>({});

    return (
        <JudgingContext.Provider
            value={{
                scores,
                setScores,
                timer,
                setTimer,
                heatStatus,
                setHeatStatus,
                overrideLogs,
                setOverrideLogs,
                judgeWorkCount,
                setJudgeWorkCount
            }}
        >
            {children}
        </JudgingContext.Provider>
    );
}

export function useJudging() {
    const context = useContext(JudgingContext);
    if (context === undefined) {
        throw new Error('useJudging must be used within a JudgingProvider');
    }
    return context;
}
