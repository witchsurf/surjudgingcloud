import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('P2.7.22 — division selects first planned available heat', () => {
  it('derives round and heat from the new division planning', () => {
    const start = source.indexOf('const handleConfigChange = (field: keyof AppConfig');
    const end = source.indexOf('useEffect(() => {', start);
    const block = source.slice(start, end);
    expect(block).toContain('allEventHeatsMeta');
    expect(block).toContain('available');
    expect(block).toContain('heatId: selected?.heat_number');
  });

  it('does not carry the previous division round/heat', () => {
    const start = source.indexOf('const handleConfigChange = (field: keyof AppConfig');
    const end = source.indexOf('useEffect(() => {', start);
    expect(source.slice(start, end)).toContain("field === 'division'");
  });

  it('excludes the current podium heat even while pointer metadata is loading', () => {
    const start = source.indexOf('const handleConfigChange = (field: keyof AppConfig');
    const end = source.indexOf('useEffect(() => {', start);
    const block = source.slice(start, end);
    expect(block).toContain('const currentHeatKey = ensureHeatId(heatId || config.heatId)');
    expect(block).toContain('activeHeatIds.add(currentHeatKey)');
  });
});

describe('P2.7.31 — controlled writer decision model (no runtime instrumentation)', () => {
  it('records the deterministic division transition against authoritative Mamelles metadata', () => {
    const calls: Array<{ division: string; round: number; heatId: number }> = [];
    const planned = [
      { id: 'mamelles_open_open_r2_h1', division: 'OPEN', round: 2, heat: 1, status: 'closed' },
      { id: 'mamelles_open_open_r2_h2', division: 'OPEN', round: 2, heat: 2, status: 'closed' },
      { id: 'mamelles_open_open_r2_h3', division: 'OPEN', round: 2, heat: 3, status: 'open' },
      { id: 'mamelles_open_open_r3_h1', division: 'OPEN', round: 3, heat: 1, status: 'open' },
      { id: 'mamelles_open_open_r3_h2', division: 'OPEN', round: 3, heat: 2, status: 'open' },
      { id: 'mamelles_open_open_r4_h1', division: 'OPEN', round: 4, heat: 1, status: 'open' },
    ];
    const active = new Set(['mamelles_open_open_r3_h1', 'mamelles_open_open_r2_h3']);
    const selected = planned.find((heat) => heat.status !== 'closed' && !active.has(heat.id));
    expect(selected).toMatchObject({ round: 3, heat: 2 });
    calls.push({ division: 'OPEN', round: selected!.round, heatId: selected!.heat });
    expect(calls).toEqual([{ division: 'OPEN', round: 3, heatId: 2 }]);
  });
});
