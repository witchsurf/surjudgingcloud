import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), 'utf8');

describe('planning import architecture', () => {
  it('keeps the canonical domain free of React, browser, Supabase and application state', () => {
    const source = [
      read('../contracts.ts'), read('../normalizeHeaders.ts'), read('../normalizeRows.ts'), read('../validate.ts'),
    ].join('\n');
    expect(source).not.toMatch(/react|supabase|repositories|stores|hooks|window|document|navigator|localStorage|indexedDB/i);
    expect(source).not.toMatch(/\.from\s*\(|\.rpc\s*\(|fetch\s*\(/);
  });

  it('keeps the local CSV adapter free of persistence and network dependencies', () => {
    const source = read('../../../adapters/planningImport/csvParser.ts');
    expect(source).not.toMatch(/supabase|ParticipantRepository|HeatPlanningRepository|repositories|stores|hooks/i);
    expect(source).not.toMatch(/\.from\s*\(|\.rpc\s*\(|fetch\s*\(/);
  });

  it('keeps the local XLSX adapter free of persistence and network dependencies', () => {
    const source = read('../../../adapters/planningImport/xlsxParser.ts');
    expect(source).not.toMatch(/supabase|ParticipantRepository|HeatPlanningRepository|repositories|stores|hooks/i);
    expect(source).not.toMatch(/\.from\s*\(|\.rpc\s*\(|fetch\s*\(/);
  });

  it('keeps H4 persistence behind the safe application service and loads XLSX dynamically', () => {
    const source = read('../../../components/PlanningImportPanel.tsx');
    expect(source).not.toMatch(/supabase|ParticipantRepository|HeatPlanningRepository|\.from\s*\(|\.rpc\s*\(/i);
    expect(source).not.toMatch(/localStorage|indexedDB|upsertMany|createWithEntries/i);
    expect(source).toMatch(/planningSafetyRepository\.preflight/);
    expect(source).not.toMatch(/persistSafePlanning/);
    expect(source).toMatch(/persistPlanningImportSafely/);
    expect(source).toMatch(/await import\(['"]\.\.\/adapters\/planningImport\/xlsxParser['"]\)/);
    expect(source).not.toMatch(/^import .*xlsxParser/m);
    expect(source).toMatch(/result\?\.input/);
  });
});
