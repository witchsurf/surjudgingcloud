import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminPage.tsx'), 'utf8');

describe('P2.7.19 single-click save', () => {
  it('publishes the resolved event id before the canonical save chain', () => {
    const start = source.indexOf('const handleConfigSaved');
    const save = source.indexOf('await saveHeatConfig', start);
    const block = source.slice(start, save);
    expect(block).toContain("localStorage.setItem('surfJudgingActiveEventId', String(targetEventId))");
    expect(block).toContain('setActiveEventId(targetEventId)');
  });
});
