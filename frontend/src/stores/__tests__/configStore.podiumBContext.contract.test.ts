import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync(resolve(process.cwd(), 'src/stores/configStore.ts'), 'utf8');

describe('P2.7.17B — podium B event context contract', () => {
  it('keeps the event name while resetting an unassigned podium lineup', () => {
    const text = source();
    expect(text).toContain("if (!activeHeat && podiumId !== 'A')");
    expect(text).toContain('competition: resolveEventDisplayName(');
    expect(text).toContain('division: snapshot.division || INITIAL_CONFIG.division');
    expect(text).toContain('configSaved: false');
  });

  it('does not fall back to the event-less open_r1_h1 context', () => {
    const text = source();
    const branch = text.slice(text.indexOf("if (!activeHeat && podiumId !== 'A')"), text.indexOf('return;', text.indexOf("if (!activeHeat && podiumId !== 'A')")));
    expect(branch).not.toContain('config: INITIAL_CONFIG');
    expect(branch).toContain('competition: resolveEventDisplayName(');
  });
});
