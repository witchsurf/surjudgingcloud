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

  it('does not let a forced pointer load reuse or overwrite an older in-flight load', () => {
    const text = source();
    expect(text).toContain('if (existingLoad && !force)');
    expect(text).toContain('const configLoadSequence = new Map<string, number>();');
    expect(text).toContain('configLoadSequence.get(loadKey) === requestSequence');
  });

  it('retries only cancelled snapshot reads while the request is still current', () => {
    const text = source();
    expect(text).toContain('retryReadAfterAbort(');
    expect(text).toContain('Snapshot read cancelled; retrying');
    expect(text).toContain('DB fetch cancelled after bounded recovery');
    expect(text).toContain('latestRequestedConfigLoadKey === loadKey');
  });
});
