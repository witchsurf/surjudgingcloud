import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/repositories/ScoreRepository.ts'), 'utf8');
const start = source.indexOf('async overrideScore(request: OverrideScoreRequest)');
const end = source.indexOf('/**\n     * Fetch override logs', start);
const overrideBlock = source.slice(start, end);

describe('ScoreRepository override hydration', () => {
  it('hydrates the canonical database score when IndexedDB has no match', () => {
    expect(overrideBlock).toContain('let existingScore =');
    expect(overrideBlock).toContain('await this.fetchScores(normalizedHeatId)');
    expect(overrideBlock).toContain('previous_score: existingScore ? existingScore.score : null');
  });
});
