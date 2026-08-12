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
});
