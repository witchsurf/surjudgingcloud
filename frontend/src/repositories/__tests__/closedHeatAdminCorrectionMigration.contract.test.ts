import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(__dirname, '../../../../backend/supabase/migrations/20260827154500_closed_heat_admin_corrections.sql'),
  'utf8',
);

describe('closed heat Admin correction contract', () => {
  it('keeps ordinary scoring blocked after heat closure', () => {
    expect(migration).toContain("v_status = 'closed'");
    expect(migration).toContain('Saisie bloquée : heat clos');
  });

  it('opens a transaction-local bypass only inside the audited RPC', () => {
    expect(migration).toContain("set_config('surfjudging.allow_closed_score_correction', 'on', true)");
    expect(migration).toContain("current_setting('surfjudging.allow_closed_score_correction', true) = 'on'");
    expect(migration).toContain('record_score_override_secure');
  });
});
