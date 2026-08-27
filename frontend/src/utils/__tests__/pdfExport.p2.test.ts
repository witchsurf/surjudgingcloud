import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../types';
import type { CompetitorHeatResult, HeatResultSnapshot, SupportedPanelSize } from '../../domain/scoring/contracts';

const { autoTableMock, saveMock } = vi.hoisted(() => ({
  autoTableMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock('jspdf-autotable', () => ({ default: autoTableMock }));
vi.mock('jspdf', () => ({
  default: class MockJsPdf {
    internal = { pageSize: { getWidth: () => 842, getHeight: () => 595 } };
    setFillColor() {}
    rect() {}
    addImage() {}
    setTextColor() {}
    setFont() {}
    setFontSize() {}
    getTextWidth(value: string) { return value.length * 5; }
    roundedRect() {}
    setDrawColor() {}
    setLineWidth() {}
    text() {}
    save = saveMock;
  },
}));

import { exportHeatScorecardPdf, shouldStartHeatTableOnFreshPage } from '../pdfExport';

const config: AppConfig = {
  competition: 'P2 PDF', division: 'OPEN', round: 1, heatId: 1,
  judges: ['J1', 'J2', 'J3'], surfers: ['ROUGE', 'BLANC'], waves: 4,
  judgeNames: {}, surferNames: { ROUGE: 'Rouge', BLANC: 'Blanc' }, surferCountries: {},
  totalSurfers: 2, surfersPerHeat: 2, totalHeats: 1, totalRounds: 1,
};

const competitor = (patch: Partial<CompetitorHeatResult> = {}): CompetitorHeatResult => ({
  lycraColor: 'ROUGE', participant: null,
  waves: [
    { waveNumber: 1, judgeScores: { J1: 7, J2: 8, J3: 9 }, retainedScores: [7, 8, 9], average: 8, complete: true, countsTowardsTotal: true },
    { waveNumber: 2, judgeScores: { J1: 6, J2: 7, J3: 8 }, retainedScores: [6, 7, 8], average: 7, complete: true, countsTowardsTotal: true },
  ],
  bestWaveNumbers: [1, 2], total: 15, rank: 1, disqualified: false,
  interferenceCount: 0, interferenceType: null, interferenceWaves: [],
  ...patch,
});

const snapshot = (panel: SupportedPanelSize, competitors = [competitor()]): HeatResultSnapshot => ({
  heatId: 'heat-pdf',
  panel: { size: panel, stations: Array.from({ length: panel }, (_, index) => `J${index + 1}`) },
  competitors,
  calculatedAt: '2026-08-05T10:00:00.000Z',
});

const exportedTable = () => autoTableMock.mock.calls[0]?.[1] as { head: string[][]; body: Array<Array<string | number>> };

describe('P2.4 canonical heat scorecard export', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([3, 5] as const)('exports the canonical snapshot for a %i-judge panel', (panel) => {
    exportHeatScorecardPdf({ config, snapshot: snapshot(panel) });

    expect(exportedTable().head[0]).toContain('BEST 2');
    expect(exportedTable().body[0]).toEqual(expect.arrayContaining(['8.00', '7.00', '8.00 + 7.00', '15.00']));
    expect(saveMock).toHaveBeenCalledOnce();
  });

  it('keeps an incomplete wave informational and excluded from the canonical total', () => {
    const incomplete = competitor({
      waves: [{ waveNumber: 1, judgeScores: { J1: 6, J2: 8 }, retainedScores: [], average: 7, complete: false, countsTowardsTotal: false }],
      bestWaveNumbers: [], total: 0,
    });
    exportHeatScorecardPdf({ config, snapshot: snapshot(3, [incomplete]) });

    expect(exportedTable().body[0]).toEqual(expect.arrayContaining(['7.00', '--', '0.00']));
  });

  it.each([
    { label: 'interference', result: competitor({ total: 7, interferenceCount: 1, interferenceType: 'INT1', interferenceWaves: [{ waveNumber: 2, type: 'INT1' }] }), expected: 'INT1 (1)' },
    { label: 'disqualification', result: competitor({ total: 0, disqualified: true, interferenceCount: 2, interferenceType: 'INT1' }), expected: 'DSQ' },
  ])('exports canonical $label state', ({ result, expected }) => {
    exportHeatScorecardPdf({ config, snapshot: snapshot(3, [result]) });
    expect(exportedTable().body[0].at(-1)).toBe(expected);
  });

  it('preserves canonical ex-aequo ranks', () => {
    exportHeatScorecardPdf({
      config,
      snapshot: snapshot(3, [competitor(), competitor({ lycraColor: 'BLANC', rank: 1 })]),
    });
    expect(exportedTable().body.map((row) => row[0])).toEqual([1, 1]);
  });

  it.each(['panel_unknown', 'panel_conflict', 'shadow_divergence'])('blocks export when %s prevented a canonical snapshot', () => {
    expect(() => exportHeatScorecardPdf({ config, snapshot: null })).toThrow('Résultat canonique indisponible');
    expect(autoTableMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('full competition PDF page safety', () => {
  it('moves a heat to a fresh page when its whole table cannot fit above the footer', () => {
    expect(shouldStartHeatTableOnFreshPage(750, 842, 3)).toBe(true);
    expect(shouldStartHeatTableOnFreshPage(120, 842, 5)).toBe(false);
  });
});
