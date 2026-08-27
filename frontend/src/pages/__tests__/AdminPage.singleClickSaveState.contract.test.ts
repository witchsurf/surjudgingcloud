import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('P2.7.21 — canonical lineup reconciliation remains scoped to the selected heat', () => {
  it('rejects stale lineup reads without blocking post-save qualifier hydration', () => {
    const start = source.indexOf('const currentConfig = configRef.current;');
    const end = source.indexOf('onConfigChange({', start);
    const reconciliation = source.slice(start, end);
    expect(reconciliation).toContain('const sameHeat =');
    expect(reconciliation).toContain('if (!sameHeat) return;');
    expect(reconciliation).not.toContain('if (configSaved) return;');
  });
});
