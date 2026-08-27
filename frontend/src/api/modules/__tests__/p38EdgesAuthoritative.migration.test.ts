import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = 'backend/supabase/migrations/20260825233000_p38_edges_authoritative_qualifier_propagation.sql';
const migrationFile = resolve(process.cwd(), `../${migrationPath}`);
const runtimeMarkerMigrationPath = 'backend/supabase/migrations/20260826120000_align_runtime_schema_version_after_p38_edges.sql';
const runtimeMarkerMigrationFile = resolve(process.cwd(), `../${runtimeMarkerMigrationPath}`);
const manifestFile = resolve(process.cwd(), '../config/p38-from-zero-manifest.json');
const bootstrapFile = resolve(process.cwd(), '../scripts/p38-bootstrap-second-runtime.sh');

describe('P3.8 authoritative progression edges from-zero contract', () => {
  it('ships the edge-aware migration in the required manifest chain with its exact SHA-256', () => {
    const source = readFileSync(migrationFile);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      migrations: Array<{ order: number; path: string; sha256: string; required: boolean }>;
    };
    const entry = manifest.migrations.find((migration) => migration.path === migrationPath);
    const actualHash = createHash('sha256').update(source).digest('hex');

    expect(entry).toEqual({ order: 12, path: migrationPath, sha256: actualHash, required: true });
  });

  it('ships a final runtime-marker migration that requires the P3.8 edge-aware objects', () => {
    const source = readFileSync(runtimeMarkerMigrationFile);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      migrations: Array<{ order: number; path: string; sha256: string; required: boolean }>;
    };
    const entry = manifest.migrations.find((migration) => migration.path === runtimeMarkerMigrationPath);
    const actualHash = createHash('sha256').update(source).digest('hex');

    expect(entry).toEqual({ order: 13, path: runtimeMarkerMigrationPath, sha256: actualHash, required: true });
    expect(manifest.migrations.some((migration) => migration.order > entry!.order)).toBe(true);
    expect(source.toString()).toContain("to_regclass('public.heat_progression_edges')");
    expect(source.toString()).toContain("fn_propagate_qualifiers_for_source_heat");
    expect(source.toString()).toContain("'20260826120000_align_runtime_schema_version_after_p38_edges'");
  });

  it('keeps bootstrap schema stamping derived from the highest manifest migration', () => {
    const bootstrap = readFileSync(bootstrapFile, 'utf8');
    expect(bootstrap).toContain("max(m['migrations'], key=lambda x: x['order'])");
    expect(bootstrap).toContain("VALUES (true, '$EXPECTED_SCHEMA_VERSION'");
  });
});
