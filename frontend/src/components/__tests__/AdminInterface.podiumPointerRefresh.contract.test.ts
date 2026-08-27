import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('AdminInterface podium pointer refresh contract', () => {
  it('re-reads podium pointers after an authoritative heat save', () => {
    const start = source.indexOf('const loadActivePodiumPointers = async () =>');
    const end = source.indexOf('const heatId = React.useMemo', start);
    const pointerEffect = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(pointerEffect).toContain('configSaved');
  });
});
