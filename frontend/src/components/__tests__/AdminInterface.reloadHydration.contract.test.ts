import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('P2.7.58 — reload hydration remains authoritative', () => {
  it('does not reconcile over a saved DB-hydrated config without pending operator navigation', () => {
    const start = source.indexOf('const pendingDivisionSelection = divisionSelectionRef.current;');
    const end = source.indexOf('const decision = reconcileRoundHeat', start);
    expect(start).toBeGreaterThan(0);
    expect(source.slice(start, end)).toContain('if (configSaved && !pendingDivisionSelection) return;');
  });

  it('still allows reconciliation for unsaved operator navigation', () => {
    const start = source.indexOf('const pendingDivisionSelection = divisionSelectionRef.current;');
    const end = source.indexOf('const decision = reconcileRoundHeat', start);
    expect(source.slice(start, end)).toContain('!pendingDivisionSelection');
  });

  it('does not clear the operator navigation latch on an ordinary config edit', () => {
    const statement = 'if (configSaved) divisionSelectionRef.current = null;';
    const start = source.indexOf(statement);
    const end = source.indexOf(']);', start) + 3;
    expect(start).toBeGreaterThan(0);
    expect(source.slice(start, end)).toContain('}, [configSaved]);');
    expect(source.slice(start, end)).not.toContain('config.division');
    expect(source.slice(start, end)).not.toContain('config.round');
    expect(source.slice(start, end)).not.toContain('config.heatId');
  });

  it('keeps the current podium heat eligible while editing its panel', () => {
    const start = source.indexOf('const otherPodiumActiveHeatIds = new Set(');
    const end = source.indexOf('const decision = reconcileRoundHeat', start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(block).toContain('pointer.podium_id');
    expect(block).toContain('selectedPodiumId');
    expect(source.slice(end, source.indexOf('});', end) + 3))
      .toContain('activeHeatIds: otherPodiumActiveHeatIds');
  });
});
