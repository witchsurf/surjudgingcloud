import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/sharedRealtimeSubscriptions.ts'), 'utf8');

describe('P2.7.65 — DB-authoritative pointer delivery', () => {
  it('reloads the committed pointer when a realtime envelope has no row body', () => {
    const start = source.indexOf('const row = payload.new as ActiveHeatPointerRealtimeRow | null;');
    const end = source.indexOf('if (!matchesEvent(row))', start);
    expect(source.slice(start, end)).toContain('if (!row?.active_heat_id)');
    expect(source.slice(start, end)).toContain('void refresh();');
  });
});
