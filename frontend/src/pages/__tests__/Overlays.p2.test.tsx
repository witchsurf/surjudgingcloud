import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ObsOverlay from '../../components/ObsOverlay';
import { clearPanelContextCache, getCachedPanelContexts } from '../../domain/scoring/panelContextCache';
import { resolveOverlaySnapshot, type OverlayScoringState } from '../../domain/scoring/overlaySnapshot';
import type { PanelContext } from '../../domain/scoring/panelContext';
import type { AppConfig, EffectiveInterference, Score } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const heatId = 'overlay-test-open-r1-h1';
const config = (judgeCount: 3 | 5, surfers = ['ROUGE']): AppConfig => ({
  competition: 'Overlay Test', division: 'OPEN', round: 1, heatId: 1,
  judges: Array.from({ length: judgeCount }, (_, index) => `J${index + 1}`), judgeNames: {},
  surfers, surferNames: Object.fromEntries(surfers.map((color) => [color, `Athlète ${color}`])), surferCountries: {},
  waves: 4, tournamentType: 'elimination', totalSurfers: surfers.length,
  surfersPerHeat: surfers.length, totalHeats: 1, totalRounds: 1,
});
const panel = (judgeCount: 3 | 5): PanelContext => ({ judgeCount, source: 'heat_config' });
const score = (
  judge: string,
  value: number,
  surfer = 'ROUGE',
  waveNumber = 1,
  id = `${surfer}-${waveNumber}-${judge}`,
): Score => ({
  id, heat_id: heatId, competition: 'Overlay Test', division: 'OPEN', round: 1,
  judge_id: judge, judge_name: judge, judge_station: judge, surfer, wave_number: waveNumber,
  score: value, timestamp: '2026-08-05T10:00:00.000Z', created_at: '2026-08-05T10:00:00.000Z',
});
const panelScores = (values: number[], surfer = 'ROUGE', wave = 1) =>
  values.map((value, index) => score(`J${index + 1}`, value, surfer, wave));

describe('OverlayPage and ObsOverlay P2 consumers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearPanelContextCache();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const resolve = (
    judgeCount: 3 | 5,
    scores: Score[],
    panelContext: PanelContext = panel(judgeCount),
    effectiveInterferences: EffectiveInterference[] = [],
    surfers = ['ROUGE'],
  ) => resolveOverlaySnapshot({ heatId, config: config(judgeCount, surfers), scores, panelContext, effectiveInterferences });

  const renderState = (state: OverlayScoringState, judgeCount: 3 | 5 = 3, surfers = ['ROUGE']) => act(() => root.render(
    <ObsOverlay
      config={config(judgeCount, surfers)}
      timer={{ isRunning: false, startTime: null, duration: 20 }}
      heatStatus="finished" snapshot={state.snapshot}
      scoringIssue={state.issue} scoringMessage={state.message}
    />,
  ));

  it('renders the canonical snapshot for a panel 3 after shadow parity', () => {
    const state = resolve(3, panelScores([6, 7, 8]));
    renderState(state);
    expect(state.snapshot?.panel.size).toBe(3);
    expect(container.querySelector('[data-overlay-lycra="ROUGE"]')?.textContent).toContain('7.00');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders the trimmed canonical snapshot for a panel 5', () => {
    const state = resolve(5, panelScores([4, 5, 6, 7, 8]));
    renderState(state, 5);
    expect(state.snapshot?.panel.size).toBe(5);
    expect(container.querySelector('[data-overlay-lycra="ROUGE"]')?.textContent).toContain('6.00');
  });

  it('does not execute or render P2 for an unknown panel', () => {
    const state = resolve(3, panelScores([6, 7, 8]), {
      judgeCount: null, source: 'unknown', issue: 'panel_unknown', message: 'Panel inconnu : configuration absente.',
    });
    renderState(state);
    expect(state.snapshot).toBeNull();
    expect(container.querySelector('[data-overlay-scoring-state="panel_unknown"]')?.textContent).toContain('Panel inconnu');
    expect(container.querySelector('[data-overlay-lycra]')).toBeNull();
  });

  it('shows a panel conflict without an official result', () => {
    const state = resolve(3, panelScores([6, 7, 8]), {
      judgeCount: null, source: 'unknown', issue: 'panel_conflict', message: 'Conflit de panel : heat_config=3, assignments=5',
    });
    renderState(state);
    expect(container.querySelector('[data-overlay-scoring-state="panel_conflict"]')?.textContent).toContain('Conflit de panel');
    expect(container.querySelector('[data-overlay-lycra]')).toBeNull();
  });

  it('logs a shadow divergence and suppresses the official overlay result', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = resolve(3, [
      score('J1', 5, 'ROUGE', 1, 'a'), score('J1', 9, 'ROUGE', 1, 'z'), score('J2', 7), score('J3', 7),
    ]);
    renderState(state);
    expect(state.issue).toBe('shadow_divergence');
    expect(container.querySelector('[data-overlay-scoring-state="shadow_divergence"]')).not.toBeNull();
    expect(container.querySelector('[data-overlay-lycra]')).toBeNull();
    expect(error).toHaveBeenCalledWith('[P2 shadow divergence]', expect.any(Object));
    error.mockRestore();
  });

  it('keeps an incomplete wave visible in the snapshot but excluded from the total', () => {
    const state = resolve(3, panelScores([6, 7]));
    renderState(state);
    expect(state.snapshot?.competitors[0].waves[0]).toMatchObject({ complete: false, average: 6.5 });
    expect(state.snapshot?.competitors[0].total).toBe(0);
    expect(container.querySelector('[data-overlay-lycra="ROUGE"]')?.textContent).toContain('0.00');
  });

  it('renders the interference penalty already applied by the canonical snapshot', () => {
    const scores = [...panelScores([8, 8, 8], 'ROUGE', 1), ...panelScores([6, 6, 6], 'ROUGE', 2)];
    const state = resolve(3, scores, panel(3), [{ surfer: 'ROUGE', waveNumber: 2, type: 'INT1', source: 'head_judge' }]);
    renderState(state);
    expect(state.snapshot?.competitors[0]).toMatchObject({ total: 11, interferenceType: 'INT1' });
    expect(container.querySelector('[data-overlay-lycra="ROUGE"]')?.textContent).toContain('INT1');
    expect(container.querySelector('[data-overlay-lycra="ROUGE"]')?.textContent).toContain('11.00');
  });

  it('preserves the canonical current ranking for an exact tie', () => {
    const surfers = ['ROUGE', 'BLEU'];
    const state = resolve(3, [
      ...panelScores([7, 7, 7], 'ROUGE'),
      ...panelScores([7, 7, 7], 'BLEU'),
    ], panel(3), [], surfers);
    renderState(state, 3, surfers);
    expect(container.querySelector('[data-overlay-lycra="ROUGE"]')?.getAttribute('data-overlay-rank')).toBe('1');
    expect(container.querySelector('[data-overlay-lycra="BLEU"]')?.getAttribute('data-overlay-rank')).toBe('1');
  });

  it('reuses the shared cache across overlay resolutions without N+1 reads', async () => {
    const loader = vi.fn(async (heatIds: readonly string[]) => new Map(
      heatIds.map((id) => [id, { judgeCount: 3 as const, source: 'heat_config' as const }]),
    ));
    const snapshots = { [heatId]: ['J1', 'J2', 'J3'] };
    await Promise.all([
      getCachedPanelContexts([heatId], snapshots, loader),
      getCachedPanelContexts([heatId], snapshots, loader),
    ]);
    await getCachedPanelContexts([heatId], snapshots, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
