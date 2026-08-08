import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('legacy heat_configs offline replay boundary', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/supabase.ts'), 'utf8');
  const repositorySource = readFileSync(resolve(process.cwd(), 'src/repositories/HeatRepository.ts'), 'utf8');
  const fixScoresSource = readFileSync(resolve(process.cwd(), 'src/pages/FixScores.tsx'), 'utf8');

  it('routes legacy upserts through the runtime RPC adapter without changing queue storage', () => {
    expect(source).toMatch(/entry\.table === 'heat_configs' && entry\.action === 'upsert'/);
    expect(source).toMatch(/await replayLegacyRuntimeHeatConfig\(supabase, entry\.payload\)/);
    expect(source).not.toMatch(/entry\.table === 'heat_configs'[\s\S]{0,800}\.from\(entry\.table\)\.upsert/);
  });

  it('leaves no authenticated runtime heat_configs write in repository or FixScores', () => {
    expect(repositorySource).not.toMatch(/\.from\(['"]heat_configs['"]\)[\s\S]{0,200}\.(?:insert|upsert|update|delete)\(/);
    expect(fixScoresSource).not.toMatch(/\.from\(['"]heat_configs['"]\)[\s\S]{0,200}\.(?:insert|upsert|update|delete)\(/);
  });
});
