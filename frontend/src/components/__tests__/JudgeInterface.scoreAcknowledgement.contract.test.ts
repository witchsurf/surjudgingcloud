import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const judge = readFileSync(resolve(process.cwd(), 'src/components/JudgeInterface.tsx'), 'utf8');
const scoreManager = readFileSync(resolve(process.cwd(), 'src/hooks/useScoreManager.ts'), 'utf8');

describe('judge score durable acknowledgement contract', () => {
  it('propagates repository failures instead of returning an undefined success', () => {
    const start = scoreManager.indexOf('const handleScoreSubmit');
    const end = scoreManager.indexOf('const handleScoreOverride', start);
    const block = scoreManager.slice(start, end);

    expect(block).toContain('): Promise<Score>');
    expect(block).toContain('throw error;');
    expect(block).not.toContain('return undefined;');
  });

  it('renders success only after a durable score identity is acknowledged', () => {
    const start = judge.indexOf('const handleScoreSubmit = async () =>');
    const end = judge.indexOf('const handleKeyPress', start);
    const block = judge.slice(start, end);
    const acknowledgementGuard = block.indexOf('if (!savedScore?.id)');
    const successFeedback = block.indexOf('setScoreFeedback');

    expect(acknowledgementGuard).toBeGreaterThan(0);
    expect(successFeedback).toBeGreaterThan(acknowledgementGuard);
    expect(block).toContain("throw new Error('La sauvegarde n\\'a fourni aucun accusé de réception durable.');");
  });

  it('refreshes only the current station partition in shared browser storage', () => {
    expect(judge).toContain('const replaceJudgeHeatScoresInStorage');
    expect(judge).toContain('return ensurePersistedHeatId(score.heat_id) !== normalizedHeatId || scoreStation !== normalizedStation;');
    expect(judge).toContain('replaceJudgeHeatScoresInStorage(myScores);');
    expect(judge).toContain('replaceJudgeHeatScoresInStorage([]);');
  });
});
