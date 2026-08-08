import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeatTimer } from '../../types';

const publishTimerStart = vi.fn(async () => undefined);
const publishTimerPause = vi.fn(async () => undefined);
const publishTimerReset = vi.fn(async () => undefined);

vi.mock('../useRealtimeSync', () => ({
  useRealtimeSync: () => ({ publishTimerStart, publishTimerPause, publishTimerReset }),
}));

import { useCompetitionTimer } from '../useCompetitionTimer';
import { useJudgingStore } from '../../stores/judgingStore';
import { useConfigStore } from '../../stores/configStore';

type TimerController = ReturnType<typeof useCompetitionTimer>;

function Harness({ expose }: { expose: (controller: TimerController) => void }) {
  const controller = useCompetitionTimer();
  useEffect(() => expose(controller), [controller, expose]);
  return null;
}

describe('competition timer characterization', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: TimerController;

  const renderTimer = async () => {
    await act(async () => {
      root.render(<Harness expose={(value) => { controller = value; }} />);
    });
  };

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T10:00:00Z'));
    localStorage.clear();
    publishTimerStart.mockClear();
    publishTimerPause.mockClear();
    publishTimerReset.mockClear();
    useJudgingStore.setState({
      timer: { isRunning: false, startTime: null, duration: 20 },
      heatStatus: 'waiting',
    });
    useConfigStore.setState((state) => ({
      ...state,
      config: { ...state.config, competition: 'Test Event', division: 'OPEN', round: 1, heatId: 'heat-timer' },
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await renderTimer();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('starts, pauses, resumes, and resets while publishing each transition', async () => {
    await act(async () => controller.startTimer());
    expect(useJudgingStore.getState().timer).toMatchObject({ isRunning: true, duration: 20 });
    expect(useJudgingStore.getState().timer.startTime?.toISOString()).toBe('2026-08-05T10:00:00.000Z');
    expect(publishTimerStart).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-08-05T10:05:00Z'));
    await act(async () => controller.pauseTimer());
    expect(useJudgingStore.getState().timer).toEqual({ isRunning: false, startTime: null, duration: 15 });
    expect(publishTimerPause).toHaveBeenLastCalledWith(expect.any(String), 15);

    await renderTimer();
    await act(async () => controller.startTimer());
    expect(useJudgingStore.getState().timer).toMatchObject({ isRunning: true, duration: 15 });
    expect(publishTimerStart).toHaveBeenCalledTimes(2);

    await renderTimer();
    await act(async () => controller.resetTimer());
    expect(useJudgingStore.getState().timer).toEqual({ isRunning: false, startTime: null, duration: 20 });
    expect(useJudgingStore.getState().heatStatus).toBe('waiting');
    expect(publishTimerReset).toHaveBeenCalledTimes(1);
  });

  it('publishes a zero-duration pause when the timer expires', async () => {
    act(() => {
      useJudgingStore.setState({
        timer: { isRunning: true, startTime: new Date('2026-08-05T10:00:00Z'), duration: 1 },
        heatStatus: 'running',
      });
    });
    await renderTimer();

    await act(async () => {
      vi.setSystemTime(new Date('2026-08-05T10:01:00Z'));
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(useJudgingStore.getState().timer).toEqual({ isRunning: false, startTime: null, duration: 0 });
    expect(useJudgingStore.getState().heatStatus).toBe('paused');
    expect(publishTimerPause).toHaveBeenCalledWith(expect.any(String), 0);
  });

  it('does not restore a stale local timer after a refresh/remount', async () => {
    const staleTimer: HeatTimer = {
      isRunning: true,
      startTime: new Date('2026-08-05T09:30:00Z'),
      duration: 20,
    };
    localStorage.setItem('surfJudgingTimer', JSON.stringify(staleTimer));
    act(() => {
      useJudgingStore.setState({ timer: { isRunning: false, startTime: null, duration: 12 } });
    });

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderTimer();

    expect(useJudgingStore.getState().timer).toEqual({ isRunning: false, startTime: null, duration: 12 });
  });
});
