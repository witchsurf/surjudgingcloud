import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('timer pause precision schema contract', () => {
  it('persists fractional remaining minutes instead of rounding a pause to a whole minute', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../backend/supabase/migrations/20260823090000_preserve_timer_pause_precision.sql',
      ),
      'utf8',
    );

    expect(migration).toMatch(
      /alter\s+column\s+timer_duration_minutes\s+type\s+numeric/iu,
    );
  });

  it('is mandatory in a from-zero Field bootstrap and becomes its authoritative schema version', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), '../config/p38-from-zero-manifest.json'), 'utf8'),
    );
    const entry = manifest.migrations.find(
      (migration: { path: string }) =>
        migration.path.endsWith('20260823090000_preserve_timer_pause_precision.sql'),
    );
    const bootstrap = readFileSync(
      resolve(process.cwd(), '../scripts/p38-bootstrap-second-runtime.sh'),
      'utf8',
    );

    expect(entry).toMatchObject({ order: 10, required: true });
    expect(bootstrap).toContain("max(m['migrations'], key=lambda x: x['order'])");
    expect(bootstrap).toContain("VALUES (true, '$EXPECTED_SCHEMA_VERSION'");
  });
});
