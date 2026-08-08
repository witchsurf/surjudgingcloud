import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRegistry } from '../RepositoryRegistry';

const sourceRoot = resolve(__dirname, '../..');
const filesBelow = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = resolve(directory, entry);
  return statSync(path).isDirectory()
    ? filesBelow(path)
    : (/\.(?:ts|tsx)$/.test(path) && !path.includes('/__tests__/') ? [path] : []);
});
const read = (path: string) => readFileSync(resolve(sourceRoot, path), 'utf8');

describe('P2.5 compatibility facade closure', () => {
  it('has no production consumer importing the global supabaseClient facade', () => {
    filesBelow(sourceRoot).forEach((path) => {
      if (path.endsWith('/api/supabaseClient.ts')) return;
      expect(readFileSync(path, 'utf8'), relative(sourceRoot, path))
        .not.toMatch(/from\s+['"][^'"]*api\/supabaseClient['"]/);
    });
  });

  it('keeps destructive planning exports outside every modern consumer', () => {
    ['components', 'pages', 'hooks', 'stores', 'services'].forEach((directory) => {
      filesBelow(resolve(sourceRoot, directory)).forEach((path) => {
        const source = readFileSync(path, 'utf8');
        expect(source, relative(sourceRoot, path)).not.toMatch(/bulk_upsert_heats(?:_safe)?\b/);
        expect(source, relative(sourceRoot, path)).not.toMatch(/deletePlannedHeats|\.deletePlanned\s*\(/);
      });
    });
  });

  it('provides one complete frozen registry for every canonical contract', () => {
    expect(Object.keys(repositoryRegistry).sort()).toEqual([
      'activeHeatPointer', 'events', 'heatLifecycle', 'heatPlanning', 'heats', 'judges',
      'panels', 'participants', 'planningSafety', 'qualificationRecovery', 'scores', 'scoringReads',
    ]);
    expect(Object.isFrozen(repositoryRegistry)).toBe(true);
    Object.values(repositoryRegistry).forEach((repository) => expect(repository).toBeTruthy());
  });

  it('keeps runtime create separate from planning and preserves open-to-waiting normalization', () => {
    const syncHook = read('hooks/useSupabaseSync.ts');
    const planning = read('repositories/HeatPlanningRepository.ts');
    expect(syncHook).toMatch(/heatData\.status === ['"]open['"]\s*\? ['"]waiting['"]/);
    expect(syncHook).toMatch(/heatRepository\.createRuntime\s*\(/);
    expect(planning).not.toMatch(/createRuntime|createHeat\s*\(/);
  });

  it('keeps dependency direction acyclic across the canonical layers', () => {
    filesBelow(resolve(sourceRoot, 'domain')).forEach((path) => {
      expect(readFileSync(path, 'utf8'), relative(sourceRoot, path))
        .not.toMatch(/from\s+['"][^'"]*(?:repositories|api\/modules|supabase)[^'"]*['"]/i);
    });
    filesBelow(resolve(sourceRoot, 'api/modules')).forEach((path) => {
      const repositoryImports = Array.from(
        readFileSync(path, 'utf8').matchAll(/from\s+['"]([^'"]*repositories[^'"]*)['"]/g),
        (match) => match[1],
      );
      expect(
        repositoryImports.filter((specifier) => !/\/repositories\/contracts(?:\/|$)/.test(specifier)),
        relative(sourceRoot, path),
      ).toEqual([]);
    });
    filesBelow(resolve(sourceRoot, 'repositories')).forEach((path) => {
      expect(readFileSync(path, 'utf8'), relative(sourceRoot, path)).not.toMatch(/api\/supabaseClient/);
    });
  });
});
