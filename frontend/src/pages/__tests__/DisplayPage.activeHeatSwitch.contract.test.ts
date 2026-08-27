import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/DisplayPage.tsx'), 'utf8');
const pointerBranch = source.slice(source.indexOf('const applyActiveHeatPointer'), source.indexOf('return subscribeToActiveHeatPointer'));

describe('P2.7.18 display active heat switch', () => {
  it('forces hydration when the active pointer changes', () => {
    expect(pointerBranch).toContain('loadConfigFromDb(activeEventId, { force: true, podiumId });');
    expect(pointerBranch).toContain('setActivePointerHeatId(row.active_heat_id);');
  });

  it('uses the canonical pointer heat ID for Display reads during a transition', () => {
    expect(source).toContain("const [activePointerHeatId, setActivePointerHeatId] = useState('');");
    expect(source).toContain('const currentHeatId = activePointerHeatId || authoritativeLiveHeatId;');
  });

  it('renders only the canonical entry colors after a smaller downstream heat is hydrated', () => {
    expect(source).toContain("const canonicalHeatSurfers = heatParticipantsSource === 'entries'");
    expect(source).toContain('surfers: canonicalHeatSurfers');
  });

  it('keeps the old heat out of the live hydration path', () => {
    expect(pointerBranch).toContain('if (!heatChanged) return;');
    expect(pointerBranch).not.toContain('window.location.reload');
  });

  it('ignores late callbacks from the previous heat subscription', () => {
    expect(source).toContain('if (liveHeatIdRef.current !== currentHeatId) return;');
  });

  it('keeps podium isolation on the active-pointer subscription', () => {
    expect(source).toContain('}, { podiumId });');
    expect(source).toContain('[activeEventId, configSaved, config.competition');
  });

  it('recovers a cancelled participant-country read without reloading the Display', () => {
    expect(source).toContain('retryReadAfterAbort(');
    expect(source).toContain('Lecture des pays annulée, nouvelle tentative');
    expect(source).not.toContain('window.location.reload');
  });
});
