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
});
