import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/repositories/ScoreRepository.ts'), 'utf8');

describe('closed heat score override path', () => {
  it('uses the atomic audited correction RPC instead of an ordinary score upsert', () => {
    const start = source.indexOf('async overrideScore(request: OverrideScoreRequest)');
    const end = source.indexOf('async fetchOverrideLogs', start);
    const block = source.slice(start, end);
    expect(block).toContain('applyScoreCorrectionSecure({');
    expect(block).toContain('score_id: existingScore.id!');
    expect(block).not.toContain('await this.upsertScoreSecure({');
  });

  it('preserves the canonical score identity for local state and audit links', () => {
    const start = source.indexOf('async overrideScore(request: OverrideScoreRequest)');
    const end = source.indexOf('async fetchOverrideLogs', start);
    const block = source.slice(start, end);
    expect(block).toContain('const updatedScoreId = existingScore.id!;');
    expect(block).toContain('score_id: existingScore.id!');
  });

  it('prefers the online canonical row over a stale offline identity', () => {
    const start = source.indexOf('async overrideScore(request: OverrideScoreRequest)');
    const end = source.indexOf('async fetchOverrideLogs', start);
    const block = source.slice(start, end);
    expect(block).toContain('if (this.isOnline)');
    expect(block).toContain('const canonicalExistingScore = canonicalScores');
    expect(block).toContain('if (canonicalExistingScore) existingScore = canonicalExistingScore;');
    expect(block).not.toContain('if (!existingScore && this.isOnline)');
  });

  it('matches French and canonical English jersey labels as one logical score cell', () => {
    const start = source.indexOf('async overrideScore(request: OverrideScoreRequest)');
    const end = source.indexOf('async fetchOverrideLogs', start);
    const block = source.slice(start, end);
    expect(source).toContain('normalizeScoreSurfer');
    expect(block.match(/normalizeScoreSurfer\(score\.surfer\) === normalizeScoreSurfer\(request\.surfer\)/g)).toHaveLength(2);
  });
});
