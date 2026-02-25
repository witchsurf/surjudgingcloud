import { useEffect, useCallback } from 'react';
import { useJudgingStore } from '../stores/judgingStore';
import { useConfigStore } from '../stores/configStore';
import { useRealtimeSync } from './useRealtimeSync';
import type { HeatTimer } from '../types';
import { DEFAULT_TIMER_DURATION } from '../utils/constants';
import { getHeatIdentifiers } from '../utils/heat';

const STORAGE_KEYS = {
    timer: 'surfJudgingTimer'
} as const;

export function useCompetitionTimer() {
    const { timer, setTimer, heatStatus, setHeatStatus } = useJudgingStore();
    const { config } = useConfigStore();
    const { publishTimerStart, publishTimerPause, publishTimerReset } = useRealtimeSync();
    const currentHeatId = getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
    ).normalized;

    // Persist timer to localStorage
    const persistTimer = useCallback((newTimer: HeatTimer) => {
        try {
            localStorage.setItem(STORAGE_KEYS.timer, JSON.stringify(newTimer));
        } catch (error) {
            console.error('❌ Error saving timer:', error);
        }
    }, []);

    // Load timer from localStorage on mount
    useEffect(() => {
        try {
            const storedTimer = localStorage.getItem(STORAGE_KEYS.timer);
            if (storedTimer) {
                const parsed = JSON.parse(storedTimer);
                setTimer({
                    ...parsed,
                    startTime: parsed.startTime ? new Date(parsed.startTime) : null
                });
            }
        } catch (error) {
            console.error('❌ Error loading timer:', error);
        }
    }, [setTimer]);

    // Timer interval logic
    useEffect(() => {
        let interval: number | undefined;

        if (timer.isRunning && timer.startTime) {
            interval = window.setInterval(() => {
                const now = new Date();
                const elapsed = (now.getTime() - new Date(timer.startTime!).getTime()) / 1000 / 60;

                if (elapsed >= timer.duration) {
                    // Timer finished
                    const finishedTimer: HeatTimer = {
                        ...timer,
                        isRunning: false
                    };
                    setTimer(finishedTimer);
                    persistTimer(finishedTimer);
                    setHeatStatus('finished');
                }
            }, 1000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [timer.isRunning, timer.startTime, timer.duration, setTimer, persistTimer, setHeatStatus]);

    const startTimer = async () => {
        if (timer.isRunning) return;

        const startTime = new Date();
        // Adjust start time if resuming? 
        // For now, simple start. If resuming, we might need to calculate remaining time.
        // The original App.tsx logic was simple start.

        const newTimer: HeatTimer = {
            ...timer,
            isRunning: true,
            startTime: startTime
        };

        setTimer(newTimer);
        persistTimer(newTimer);
        setHeatStatus('running');

        try {
            await publishTimerStart(currentHeatId, config, timer.duration);
        } catch (error) {
            console.error('Failed to publish timer start:', error);
        }
    };

    const pauseTimer = async () => {
        if (!timer.isRunning) return;

        const elapsedMinutes = timer.startTime
            ? (Date.now() - new Date(timer.startTime).getTime()) / 1000 / 60
            : 0;
        const remainingDuration = Math.max(0, timer.duration - elapsedMinutes);

        const newTimer: HeatTimer = {
            ...timer,
            isRunning: false,
            startTime: null,
            duration: remainingDuration
        };

        setTimer(newTimer);
        persistTimer(newTimer);
        setHeatStatus('paused');

        try {
            await publishTimerPause(currentHeatId, remainingDuration);
        } catch (error) {
            console.error('Failed to publish timer pause:', error);
        }
    };

    const resetTimer = async () => {
        const newTimer: HeatTimer = {
            isRunning: false,
            startTime: null,
            duration: DEFAULT_TIMER_DURATION
        };

        setTimer(newTimer);
        persistTimer(newTimer);
        setHeatStatus('waiting');

        try {
            await publishTimerReset(currentHeatId, DEFAULT_TIMER_DURATION);
        } catch (error) {
            console.error('Failed to publish timer reset:', error);
        }
    };

    const setDuration = (minutes: number) => {
        const newTimer = { ...timer, duration: minutes };
        setTimer(newTimer);
        persistTimer(newTimer);
    };

    return {
        timer,
        startTimer,
        pauseTimer,
        resetTimer,
        setDuration
    };
}
