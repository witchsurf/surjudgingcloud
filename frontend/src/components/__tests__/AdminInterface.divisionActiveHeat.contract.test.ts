import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');
const start = source.indexOf('const handleConfigChange = (field: keyof AppConfig');
const end = source.indexOf('useEffect(() => {', start);
const block = source.slice(start, end);

describe('P2.7.31 — division destination eligibility', () => {
  it('uses authoritative planned heat status, not stale division sequence state', () => {
    expect(block).toContain('isLockedStatus(authoritativeHeatStatusRef.current.get');
    expect(source).toContain('authoritativeHeatStatusRef.current');
    expect(block).not.toContain('isHeatClosed(heat.heat_number, heat.round)');
  });

  it('skips every active pointer, including the current podium heat', () => {
    expect(block).toContain('activeHeatIds');
    expect(block).toContain('!activeHeatIds.has(ensureHeatId(heat.id))');
  });

  it('has no unsafe fallback to the first planned heat', () => {
    expect(block).not.toContain('|| planned[0]');
  });
});
