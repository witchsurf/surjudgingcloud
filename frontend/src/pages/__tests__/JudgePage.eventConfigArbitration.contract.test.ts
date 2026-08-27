import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/JudgePage.tsx'), 'utf8');

describe('JudgePage event config arbitration contract', () => {
  it('does not let the legacy event snapshot bypass the podium pointer', () => {
    const start = source.indexOf('// Realtime sync for admin config saves');
    const firstEffect = source.indexOf('useEffect(() => {', start);
    const end = source.indexOf('useEffect(() => {', firstEffect + 1);
    const eventConfigEffect = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(eventConfigEffect).toContain('loadConfigFromDb(targetEventId');
    expect(eventConfigEffect).toContain('podiumId');
    expect(eventConfigEffect).not.toContain('preferActivePointer: false');
  });
});
