import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(__dirname, '../../../../backend/supabase/migrations/20260827161500_guard_score_rpc_against_stale_replay.sql'),
  'utf8',
);

describe('score RPC stale replay contract', () => {
  it('updates an existing UUID only when the replay is not older than the durable fact', () => {
    expect(migration).toContain('on conflict (id) do update');
    expect(migration).toContain('where coalesce(excluded.timestamp, excluded.created_at');
    expect(migration).toContain('>= coalesce(scores.timestamp, scores.created_at');
  });

  it('acknowledges a rejected stale replay with the current durable row', () => {
    expect(migration).toContain('if v_result is null then');
    expect(migration).toContain('where s.id = p_id::text');
  });
});
