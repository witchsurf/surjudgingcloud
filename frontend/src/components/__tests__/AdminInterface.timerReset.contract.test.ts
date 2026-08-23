import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Admin timer RESET contract', () => {
  it('restores the configured full duration after a pause', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/AdminInterface.tsx'),
      'utf8',
    );
    const resetHandler = source.slice(
      source.indexOf('const handleTimerReset ='),
      source.indexOf('const handleTimerDurationChange ='),
    );

    expect(resetHandler).toContain(
      'const fullDuration = Math.max(1, plannedTimerDuration || timer.duration || 20);',
    );
    expect(resetHandler).toMatch(/duration:\s*fullDuration/);
  });
});
