import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminPage.tsx'), 'utf8');

describe('AdminPage archived heat hydration guard', () => {
  it('releases the in-flight ref but preserves explicit operator edits on the current heat', () => {
    const start = source.indexOf('// A manual division/round/heat selection must load its own canonical');
    const end = source.indexOf('// Load participant names for current heat', start);
    const block = source.slice(start, end);

    expect(block).toContain('hydratedManualHeatRef.current = hydrationKey;');
    expect(block).toContain('.finally(() => {');
    expect(block).toContain('hydratedManualHeatRef.current = null;');
    expect(block).toContain('operatorDirtyHeatRef.current === canonicalHeatId');
    expect(block).not.toContain('if (!storedConfig) return;');
  });
});
