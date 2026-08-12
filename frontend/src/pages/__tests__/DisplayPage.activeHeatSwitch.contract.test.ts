import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/DisplayPage.tsx'), 'utf8');
const pointerBranch = source.slice(source.indexOf('const applyActiveHeatPointer'), source.indexOf('return subscribeToActiveHeatPointer'));

describe('P2.7.18 display active heat switch', () => {
  it('forces hydration when the active pointer changes', () => {
    expect(pointerBranch).toContain('loadConfigFromDb(activeEventId, { force: true, podiumId });');
  });

  it('keeps the old heat out of the live hydration path', () => {
    expect(pointerBranch).toContain('if (!heatChanged) return;');
    expect(pointerBranch).not.toContain('window.location.reload');
  });

  it('keeps podium isolation on the active-pointer subscription', () => {
    expect(source).toContain('}, { podiumId });');
    expect(source).toContain('[activeEventId, configSaved, config.competition');
  });
});
