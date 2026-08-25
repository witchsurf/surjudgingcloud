import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/sharedRealtimeSubscriptions.ts'), 'utf8');

describe('shared realtime subscriptions client access', () => {
  it('uses the canonical dynamic client for event_last_config subscriptions', () => {
    const start = source.indexOf('export const subscribeToEventConfig');
    const end = source.indexOf('export const subscribeToActiveHeatPointer', start);
    const eventConfigSubscription = source.slice(start, end);

    expect(eventConfigSubscription).toContain('const client = getClient();');
    expect(eventConfigSubscription).toContain('state.channel = (client as any)');
    expect(eventConfigSubscription).not.toMatch(/(?<![.\w])supabase(?![\w])/);
  });
});
