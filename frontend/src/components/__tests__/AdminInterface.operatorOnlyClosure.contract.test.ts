import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readAdminInterface = () =>
  readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('AdminInterface operator-only heat closure contract', () => {
  it('does not derive "already judged" from timer expiration, finished status, or partial scores', () => {
    const source = readAdminInterface();

    expect(source).toContain('const currentHeatAlreadyRan = stableHeatLocked;');
    expect(source).not.toContain('isCurrentHeatFinished ||');
    expect(source).not.toContain('timerHasExpired ||');
    expect(source).not.toContain('(currentHeatHasScores && !timer.isRunning && !timer.startTime)');
  });

  it('keeps the rejudge protection reason authoritative and closed-only', () => {
    const source = readAdminInterface();

    expect(source).toContain("const rejudgeProtectionReason = stableHeatLocked ? 'closed' : null;");
    expect(source).not.toContain("? 'finished'");
    expect(source).not.toContain("? 'scores'");
  });
});
