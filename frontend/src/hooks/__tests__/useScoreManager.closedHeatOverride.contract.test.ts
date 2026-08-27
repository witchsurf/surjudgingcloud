import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useScoreManager.ts'), 'utf8');
const admin = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('closed heat override UI contract', () => {
  it('does not require an active/saved panel to correct a canonical archived heat', () => {
    const start = hook.indexOf('const handleScoreOverride');
    const end = hook.indexOf('const handleScoreSync', start);
    const block = hook.slice(start, end);
    expect(block).not.toContain('!configSaved');
    expect(block).toContain('ensurePersistedHeatId(heatId)');
  });

  it('propagates persistence failures and never reports undefined as success', () => {
    const start = hook.indexOf('const handleScoreOverride');
    const end = hook.indexOf('const handleScoreSync', start);
    expect(hook.slice(start, end)).toContain('throw error;');
    expect(admin).toContain('Aucune correction n’a été confirmée par la base.');
  });
});
