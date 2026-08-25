import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/PendingJudgeAssignmentPoller.tsx'), 'utf8');

describe('PendingJudgeAssignmentPoller schema contract', () => {
  it('uses only the canonical podium assignment source and never selects the removed config_data field', () => {
    expect(source).toContain('panelRepository.getPodiumPanel');
    expect(source).not.toContain(".from('event_last_config')");
    expect(source).not.toContain(".select('config_data')");
  });
});
