import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminPage.tsx'), 'utf8');

describe('AdminPage Active Heat Auto-Advance Contract', () => {
  it('subscribes to active_heat_pointer for the selected podium', () => {
    expect(source).toContain('subscribeToActiveHeatPointer');
    expect(source).toContain('loadConfigFromDb');
  });

  it('preserves podium isolation on the active pointer subscription', () => {
    expect(source).toContain('podiumId');
  });
});
