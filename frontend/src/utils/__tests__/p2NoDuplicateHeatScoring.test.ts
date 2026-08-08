import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('P2.4 final consumers contain no duplicated heat scoring', () => {
  it.each(['../pdfExport.ts', '../ranking.ts'])('%s does not call legacy or low-level scoring', (path) => {
    const contents = source(path);
    expect(contents).not.toMatch(/calculateSurferStats|rankSurfers|getEffectiveJudgeCount|computeEffectiveInterferences/);
    expect(contents).not.toMatch(/scores\.filter\([^)]*wave_number|reduce\([^)]*score/);
  });

  it('keeps progression, qualification, points and championship ranking outside the heat engine', () => {
    const contents = source('../ranking.ts');
    expect(contents).toContain('getPointsForRank');
    expect(contents).toContain('advancedSurfers');
    expect(contents).toContain('qualifiers');
    expect(contents).toContain('surferTerminus');
  });
});
