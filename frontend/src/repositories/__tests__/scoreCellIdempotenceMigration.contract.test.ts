import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(__dirname, '../../../../backend/supabase/migrations/20260827153000_score_cell_idempotence.sql'),
  'utf8',
);

describe('score cell persistence contract', () => {
  it('preserves historical rows and indexes the normalized station/lycra/wave identity', () => {
    expect(migration).not.toContain('delete from public.scores');
    expect(migration).not.toContain('create unique index');
    expect(migration).toContain('scores_station_lycra_wave_lookup_idx');
    expect(migration).toContain('upper(trim(judge_station))');
    expect(migration).toContain('upper(trim(surfer))');
  });

  it('serializes concurrent inserts and keeps the stable existing identity', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('v_existing.id is distinct from new.id');
    expect(migration).toContain('return null;');
  });

  it('does not let an older replay overwrite a newer score', () => {
    expect(migration).toContain('v_incoming_time >=');
    expect(migration).toContain("'-infinity'::timestamptz");
  });

  it('acknowledges an identical lost-ACK replay without touching a closed heat', () => {
    expect(migration).toContain('v_incoming_time = coalesce(v_existing.timestamp, v_existing.created_at)');
    expect(migration).toContain('new.score is not distinct from v_existing.score');
  });
});
