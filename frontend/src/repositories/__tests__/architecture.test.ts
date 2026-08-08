import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '../..');

const filesBelow = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = resolve(directory, entry);
  return statSync(path).isDirectory() ? filesBelow(path) : path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
});

const readSources = (directory: string) => filesBelow(directory).map((path) => ({
  path,
  source: readFileSync(path, 'utf8'),
}));

describe('P2.5 repository architecture boundaries', () => {
  it('keeps repository contracts independent from Supabase and PostgREST', () => {
    const contracts = readSources(resolve(sourceRoot, 'repositories/contracts'));
    expect(contracts.length).toBeGreaterThan(0);
    contracts.forEach(({ path, source }) => {
      expect(source, path).not.toMatch(/from\s+['"][^'"]*(supabase|postgrest)[^'"]*['"]/i);
      expect(source, path).not.toMatch(/\b(?:SupabaseClient|PostgrestError|PostgrestResponse|Database\s*\[|Tables\s*<|TablesInsert\s*<|TablesUpdate\s*<)\b/);
    });
  });

  it('keeps api/modules independent from React, hooks and stores', () => {
    readSources(resolve(sourceRoot, 'api/modules')).forEach(({ path, source }) => {
      expect(source, path).not.toMatch(/from\s+['"](?:react|react-dom|[^'"]*\/hooks(?:\/|['"])|[^'"]*\/stores(?:\/|['"]))/);
    });
  });

  it('keeps domain independent from repositories', () => {
    readSources(resolve(sourceRoot, 'domain')).forEach(({ path, source }) => {
      expect(source, path).not.toMatch(/from\s+['"][^'"]*repositories(?:\/[^'"]*)?['"]/);
    });
  });

  it('does not expose generated database row aliases through public contracts', () => {
    readSources(resolve(sourceRoot, 'repositories/contracts')).forEach(({ path, source }) => {
      expect(source, path).not.toMatch(/supabase\.generated|supabaseDatabase|types\/database/);
      expect(source, path).not.toMatch(/\bDatabase\b|\bTablesInsert\b|\bTablesUpdate\b|\bPostgrest/);
    });
  });
});
