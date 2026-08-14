import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

describe('P2.7.57 — unsaved selection does not activate pointer', () => {
  it('does not call the heat activation RPC from the automatic panel preparation effect', () => {
    const start = source.indexOf('const selectedHeatStatus');
    const end = source.indexOf('const handleSaveOfflineAdminPin', start);
    const block = source.slice(start, end);
    expect(block).toContain("setPodiumPanel");
    expect(block).not.toContain('heatLifecycleRepository.activate');
    expect(block).not.toContain('admin-auto-podium-activate');
  });

  it('keeps activation in the canonical SAVE repository path', () => {
    const heatRepository = readFileSync(resolve(process.cwd(), 'src/repositories/HeatRepository.ts'), 'utf8');
    expect(heatRepository).toContain('activateHeatOnPodium');
    expect(heatRepository).toContain("assignedBy: 'admin'");
  });
});
