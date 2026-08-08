import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('safe planning production boundary', () => {
  it('has no direct legacy bulk RPC call in the modern planning adapter', () => {
    const source = read('../../api/modules/heats.api.ts');
    expect(source).not.toMatch(/\.rpc\(['"]bulk_upsert_heats['"]/);
    expect(source).toMatch(/persistSafePlanningRpc|persistPlanning/);
    expect(source).toMatch(/is_active:\s*false/);
    expect(source).not.toMatch(/\.from\(['"]heat_configs['"]\)/);

    const safeAdapter = read('../../api/modules/planningSafety.api.ts');
    expect(safeAdapter).toMatch(/\.rpc\(['"]bulk_upsert_heats_safe_v2['"]/);
    expect(safeAdapter).not.toMatch(/\.rpc\(['"]bulk_upsert_heats_safe['"]/);
    expect(safeAdapter).not.toMatch(/\.rpc\(['"]bulk_upsert_heats['"]/);
  });

  it('does not initialize an active pointer from bracket planning UI', () => {
    const source = read('../../pages/ParticipantsStructure.tsx');
    expect(source).not.toMatch(/activeHeatPointerRepository|upsertActiveHeatPointer/);
  });

  it('connects H4 only to the safe application service', () => {
    const panel = read('../../components/PlanningImportPanel.tsx');
    expect(panel).toMatch(/persistPlanningImportSafely/);
    expect(panel).not.toMatch(/createWithEntries|persistSafePlanning|participantRepository|\.rpc\(|\.from\(/);
    expect(panel).not.toMatch(/activeHeatPointer|startTimer|ScoreRepository|\.from\(['"]scores/);

    const service = read('../../services/persistPlanningImportSafely.ts');
    expect(service).toMatch(/heatPlanningRepository\.createWithEntries/);
    expect(service).not.toMatch(/bulk_upsert_heats|activeHeatPointer|startTimer|ScoreRepository/);
  });
});
