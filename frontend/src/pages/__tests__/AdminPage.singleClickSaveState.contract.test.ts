import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('P2.7.21 — save state remains clean after RPC success', () => {
  it('guards internal lineup reconciliation after canonical save', () => {
    const start = source.indexOf('const currentConfig = configRef.current;');
    const end = source.indexOf('onConfigChange({', start);
    expect(source.slice(start, end)).toContain('if (configSaved) return;');
  });
});
