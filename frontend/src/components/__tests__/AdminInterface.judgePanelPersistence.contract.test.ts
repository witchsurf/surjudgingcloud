import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('Admin judge panel persistence', () => {
  it('keeps official names when the operator changes the panel size', () => {
    expect(source).toContain('const linkedOfficial = availableOfficialJudges.find');
    expect(source).toContain('linkedOfficial?.name || config.judgeNames?.[id] || id');
    expect(source).not.toContain('const judgeNames = judgeIds.reduce((acc, id) => ({ ...acc, [id]: id })');
  });

  it('releases stale manual navigation after canonical config hydration', () => {
    expect(source).toContain('if (configSaved) divisionSelectionRef.current = null;');
  });
});
