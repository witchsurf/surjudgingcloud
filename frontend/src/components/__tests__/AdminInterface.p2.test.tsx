import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHeatResultSnapshotPanel from '../AdminHeatResultSnapshotPanel';
import { resolveConsumerHeatSnapshot, type OverlayScoringState } from '../../domain/scoring/overlaySnapshot';
import type { PanelContext } from '../../domain/scoring/panelContext';
import type { AppConfig, EffectiveInterference, Score } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const heatId = 'admin-p2-open-r1-h1';
const config = (judgeCount: 3 | 5, surfers = ['ROUGE']): AppConfig => ({
  competition: 'Admin P2', division: 'OPEN', round: 1, heatId: 1,
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
  id, heat_id: heatId, competition: 'Admin P2', division: 'OPEN', round: 1,
  judge_id: judge, judge_name: judge, judge_station: judge, surfer, wave_number: waveNumber,
  score: value, timestamp: '2026-08-05T10:00:00.000Z', created_at: '2026-08-05T10:00:00.000Z',
});
const panelScores = (values: number[], surfer = 'ROUGE', wave = 1) =>
  values.map((value, index) => score(`J${index + 1}`, value, surfer, wave));

describe('AdminInterface canonical P2 result', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const resolveState = (
    judgeCount: 3 | 5,
    scores: Score[],
    panelContext: PanelContext = panel(judgeCount),
    effectiveInterferences: EffectiveInterference[] = [],
    surfers = ['ROUGE'],
  ) => resolveConsumerHeatSnapshot({ heatId, config: config(judgeCount, surfers), scores, panelContext, effectiveInterferences });

  const renderState = (state: OverlayScoringState, surferNames: Record<string, string> = { ROUGE: 'Athlète rouge' }) => act(() => root.render(
    <AdminHeatResultSnapshotPanel
      snapshot={state.snapshot} issue={state.issue} message={state.message} surferNames={surferNames}
    />,
  ));

  it('renders averages, best waves, total and rank from a panel 3 snapshot', () => {
    const state = resolveState(3, panelScores([6, 7, 8]));
    renderState(state);
    const row = container.querySelector('[data-admin-result-lycra="ROUGE"]');
    expect(row?.textContent).toContain('V1:7.00');
    expect(row?.textContent).toContain('7.00');
    expect(row?.getAttribute('data-admin-result-rank')).toBe('1');
  });

  it('renders the canonical trim for a panel 5', () => {
    const state = resolveState(5, panelScores([4, 5, 6, 7, 8]));
    renderState(state);
    expect(state.snapshot?.competitors[0].waves[0].retainedScores).toEqual([5, 6, 7]);
    expect(container.querySelector('[data-admin-result-lycra="ROUGE"]')?.textContent).toContain('6.00');
  });

  it('marks an incomplete wave and excludes it from the total', () => {
    const state = resolveState(3, panelScores([6, 7]));
    renderState(state);
    expect(state.snapshot?.competitors[0].total).toBe(0);
    expect(container.querySelector('[data-admin-result-lycra="ROUGE"]')?.textContent).toContain('V1:6.50*');
  });

  it('renders an interference penalty already applied by the snapshot', () => {
    const scores = [...panelScores([8, 8, 8], 'ROUGE', 1), ...panelScores([6, 6, 6], 'ROUGE', 2)];
    const state = resolveState(3, scores, panel(3), [{ surfer: 'ROUGE', waveNumber: 2, type: 'INT1', source: 'head_judge' }]);
    renderState(state);
    expect(state.snapshot?.competitors[0].total).toBe(11);
    expect(container.querySelector('[data-admin-result-lycra="ROUGE"]')?.textContent).toContain('INT1 (1)');
  });

  it('renders a disqualification from the canonical snapshot', () => {
    const scores = [...panelScores([8, 8, 8], 'ROUGE', 1), ...panelScores([6, 6, 6], 'ROUGE', 2)];
    const state = resolveState(3, scores, panel(3), [
      { surfer: 'ROUGE', waveNumber: 1, type: 'INT1', source: 'head_judge' },
      { surfer: 'ROUGE', waveNumber: 2, type: 'INT1', source: 'head_judge' },
    ]);
    renderState(state);
    expect(state.snapshot?.competitors[0]).toMatchObject({ disqualified: true, total: 0 });
    expect(container.querySelector('[data-admin-result-lycra="ROUGE"]')?.textContent).toContain('DISQUALIFIÉ');
  });

  it('preserves the current canonical ex aequo ranking', () => {
    const surfers = ['ROUGE', 'BLEU'];
    const state = resolveState(3, [
      ...panelScores([7, 7, 7], 'ROUGE'), ...panelScores([7, 7, 7], 'BLEU'),
    ], panel(3), [], surfers);
    renderState(state, { ROUGE: 'Rouge', BLEU: 'Bleu' });
    expect(container.querySelector('[data-admin-result-lycra="ROUGE"]')?.getAttribute('data-admin-result-rank')).toBe('1');
    expect(container.querySelector('[data-admin-result-lycra="BLEU"]')?.getAttribute('data-admin-result-rank')).toBe('1');
  });

  it('keeps scores attached to the lycra when the lineup participant is overridden', () => {
    const state = resolveState(3, panelScores([6, 7, 8]));
    renderState(state, { ROUGE: 'Participant initial' });
    expect(container.querySelector('[data-admin-result-lycra="ROUGE"]')?.textContent).toContain('Participant initial');
    renderState(state, { ROUGE: 'Participant remplacé' });
    const row = container.querySelector('[data-admin-result-lycra="ROUGE"]');
    expect(row?.textContent).toContain('Participant remplacé');
    expect(row?.textContent).toContain('7.00');
    expect(state.snapshot?.competitors[0].lycraColor).toBe('ROUGE');
  });

  it.each([
    ['panel_unknown', 'Panel inconnu'],
    ['panel_conflict', 'Conflit de panel'],
    ['network_error', 'Erreur réseau de lecture du panel'],
  ] as const)('blocks an official result for %s', (issue, message) => {
    const state = resolveState(3, panelScores([6, 7, 8]), {
      judgeCount: null, source: 'unknown', issue, message,
    });
    renderState(state);
    expect(container.querySelector(`[data-admin-scoring-state="${issue}"]`)?.textContent).toContain(message);
    expect(container.querySelector('[data-admin-result-lycra]')).toBeNull();
  });

  it('logs and blocks a shadow divergence', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = resolveState(3, [
      score('J1', 5, 'ROUGE', 1, 'a'), score('J1', 9, 'ROUGE', 1, 'z'), score('J2', 7), score('J3', 7),
    ]);
    renderState(state);
    expect(state.issue).toBe('shadow_divergence');
    expect(container.querySelector('[data-admin-scoring-state="shadow_divergence"]')).not.toBeNull();
    expect(container.querySelector('[data-admin-result-lycra]')).toBeNull();
    expect(error).toHaveBeenCalledWith('[P2 shadow divergence]', expect.any(Object));
    error.mockRestore();
  });

  it('contains no duplicated heat-result calculation in AdminInterface', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');
    expect(source).not.toContain('calculateSurferStats');
    expect(source).not.toContain('getEffectiveJudgeCount');
    expect(source).toContain('resolveConsumerHeatSnapshot');
    expect(source).toContain('<AdminHeatResultSnapshotPanel');
  });
});
