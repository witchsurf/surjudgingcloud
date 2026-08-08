import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScoreDisplay from '../../components/ScoreDisplay';
import type { PanelContext } from '../../domain/scoring/panelContext';
import type { AppConfig, Score } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../api/modules/scoring.api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/modules/scoring.api')>(),
  fetchInterferenceCalls: vi.fn(async () => []),
}));
vi.mock('../../hooks/useHeatParticipantDetails', () => ({
  useHeatParticipantDetails: () => ({ entryMap: new Map(), loading: false, error: null }),
}));
vi.mock('../../lib/sharedHeatTableSubscriptions', () => ({
  subscribeToHeatInterference: () => () => undefined,
}));
vi.mock('../../utils/pdfExport', () => ({ exportHeatScorecardPdf: vi.fn() }));

const config = (judgeCount: number): AppConfig => ({
  competition: 'Display P2', division: 'OPEN', round: 1, heatId: 1,
  judges: Array.from({ length: judgeCount }, (_, index) => `J${index + 1}`),
  judgeNames: {}, surfers: ['ROUGE'], surferNames: { ROUGE: 'Athlète rouge' }, surferCountries: {},
  surfersPerHeat: 1, waves: 4, tournamentType: 'elimination', totalSurfers: 1, totalHeats: 1, totalRounds: 1,
});

const score = (judge: string, value: number, id = judge): Score => ({
  id, heat_id: 'display-p2-open-r1-h1', competition: 'Display P2', division: 'OPEN', round: 1,
  judge_id: judge, judge_name: judge, judge_station: judge, surfer: 'ROUGE', wave_number: 1,
  score: value, timestamp: '2026-08-05T10:00:00.000Z', created_at: '2026-08-05T10:00:00.000Z',
});

const panel = (judgeCount: 3 | 5): PanelContext => ({ judgeCount, source: 'heat_config' });

describe('DisplayPage P2 scoring boundary', () => {
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

  const renderDisplay = async (scores: Score[], panelContext: PanelContext, judgeCount = panelContext.judgeCount || 3) => {
    await act(async () => {
      root.render(
        <ScoreDisplay
          config={config(judgeCount)} scores={scores}
          timer={{ isRunning: false, startTime: null, duration: 0 }}
          configSaved heatStatus="finished" panelContext={panelContext}
        />,
      );
      await Promise.resolve();
    });
  };

  it('displays P2 after exact shadow parity for a deterministic panel 3', async () => {
    await renderDisplay([score('J1', 6), score('J2', 7), score('J3', 8)], panel(3));
    expect(container.textContent).toContain('7.00');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('displays the trimmed P2 average for a deterministic panel 5', async () => {
    await renderDisplay([4, 5, 6, 7, 8].map((value, index) => score(`J${index + 1}`, value)), panel(5), 5);
    expect(container.textContent).toContain('6.00');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('distinguishes an unknown panel and does not display a calculated total', async () => {
    await renderDisplay([score('J1', 6), score('J2', 7)], {
      judgeCount: null, source: 'unknown', issue: 'panel_unknown', message: 'Panel inconnu : configuration absente.',
    });
    expect(container.querySelector('[data-panel-state="panel_unknown"]')?.textContent).toContain('Panel inconnu');
    expect(container.textContent).not.toContain('6.50');
  });

  it('distinguishes a conflict between panel sources', async () => {
    await renderDisplay([score('J1', 6), score('J2', 7), score('J3', 8)], {
      judgeCount: null, source: 'unknown', issue: 'panel_conflict', message: 'Conflit de panel : heat_config=3, assignments=5',
    });
    expect(container.querySelector('[data-panel-state="panel_conflict"]')?.textContent).toContain('Conflit de panel');
    expect(container.textContent).not.toContain('7.00');
  });

  it('distinguishes a panel network read error', async () => {
    await renderDisplay([], {
      judgeCount: null, source: 'unknown', issue: 'network_error', message: 'Erreur réseau de lecture du panel : service indisponible',
    });
    expect(container.querySelector('[data-panel-state="network_error"]')?.textContent).toContain('Erreur réseau');
  });

  it('keeps a two-note wave incomplete when the real panel is 3', async () => {
    await renderDisplay([score('J1', 6), score('J2', 7)], panel(3));
    expect(container.textContent).toMatch(/ROUGE6\.50.*0\.00/);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps a four-note wave incomplete when the real panel is 5', async () => {
    await renderDisplay([4, 5, 6, 7].map((value, index) => score(`J${index + 1}`, value)), panel(5), 5);
    expect(container.textContent).toMatch(/ROUGE5\.50.*0\.00/);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('logs a shadow divergence and suppresses the ambiguous official result', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderDisplay([
      score('J1', 5, 'a'), score('J1', 9, 'z'), score('J2', 7), score('J3', 7),
    ], panel(3));
    expect(container.querySelector('[data-panel-state="shadow_issue"]')?.textContent).toContain('Divergence scoring P2');
    expect(container.textContent).not.toContain('6.33');
    expect(error).toHaveBeenCalledWith('[P2 shadow divergence]', expect.any(Object));
    error.mockRestore();
  });
});
