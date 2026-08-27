import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(__dirname, '../../../../backend/supabase/migrations/20260827150000_atomic_podium_active_heat_flags.sql'),
  'utf8',
);

describe('activate_heat_on_podium active flag contract', () => {
  it('serializes activations for one event and podium', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("activate_heat_on_podium:%s:%s");
  });

  it('retires only active flags no longer referenced by a podium pointer', () => {
    expect(migration).toContain('not exists (');
    expect(migration).toContain('pointer.active_heat_id = h.id');
    expect(migration).toContain('set is_active = false');
  });

  it('keeps the selected heat active and rejects invalid podium ids', () => {
    expect(migration).toContain("v_podium_id not in ('A', 'B')");
    expect(migration).toContain('is_active = true');
  });
});
