/**
 * Judging Store (Zustand)
 * 
 * Manages scoring, timer, and heat status state.
 * Replaces the old JudgingContext for better performance.
 */

import { create } from 'zustand';
import type { Score, HeatTimer, ScoreOverrideLog } from '../types';
import { DEFAULT_TIMER_STATE } from '../utils/constants';

interface JudgingStore {
    // State
    scores: Score[];
    timer: HeatTimer;
    heatStatus: 'waiting' | 'running' | 'paused' | 'finished';
    overrideLogs: ScoreOverrideLog[];
    judgeWorkCount: Record<string, number>;

    // Actions
    setScores: (scores: Score[] | ((prev: Score[]) => Score[])) => void;
    setTimer: (timer: HeatTimer | ((prev: HeatTimer) => HeatTimer)) => void;
    setHeatStatus: (status: 'waiting' | 'running' | 'paused' | 'finished') => void;
    setOverrideLogs: (logs: ScoreOverrideLog[] | ((prev: ScoreOverrideLog[]) => ScoreOverrideLog[])) => void;
    setJudgeWorkCount: (count: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;

    // Helper actions
    resetJudging: () => void;
}

export const useJudgingStore = create<JudgingStore>((set) => ({
    // Initial state
    scores: [],
    timer: DEFAULT_TIMER_STATE,
    heatStatus: 'waiting',
    overrideLogs: [],
    judgeWorkCount: {},

    // Actions
    setScores: (scores) => set((state) => ({
        scores: typeof scores === 'function' ? scores(state.scores) : scores
    })),

    setTimer: (timer) => set((state) => ({
        timer: typeof timer === 'function' ? timer(state.timer) : timer
    })),

    setHeatStatus: (heatStatus) => set({ heatStatus }),

    setOverrideLogs: (logs) => set((state) => ({
        overrideLogs: typeof logs === 'function' ? logs(state.overrideLogs) : logs
    })),

    setJudgeWorkCount: (count) => set((state) => ({
        judgeWorkCount: typeof count === 'function' ? count(state.judgeWorkCount) : count
    })),

    // Helper to reset all judging state
    resetJudging: () => set({
        scores: [],
        timer: DEFAULT_TIMER_STATE,
        heatStatus: 'waiting',
        overrideLogs: [],
        judgeWorkCount: {},
    }),
}));
