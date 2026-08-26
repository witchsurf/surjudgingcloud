import { describe, expect, it } from 'vitest';
import { deriveLivePublicationState } from '../livePublicationStatus';

const now = Date.parse('2026-08-26T12:00:00.000Z');
const base = { configured: true, local_field: true, worker_heartbeat_at: '2026-08-26T11:59:50.000Z' };

describe('deriveLivePublicationState', () => {
  it('keeps absent configuration visibly separate from an outage', () => {
    expect(deriveLivePublicationState({ configured: false, local_field: true }, now)).toBe('NOT_CONFIGURED');
  });

  it('reports live only with a recent local worker heartbeat and no backlog', () => {
    expect(deriveLivePublicationState(base, now)).toBe('LIVE');
  });

  it('prioritizes retained publications over a healthy worker', () => {
    expect(deriveLivePublicationState({ ...base, pending_count: 2 }, now)).toBe('BACKLOG');
  });

  it('keeps a recent delivery error visible once the queue is empty', () => {
    expect(deriveLivePublicationState({ ...base, last_error_at: '2026-08-26T11:58:00.000Z' }, now)).toBe('DEGRADED');
  });

  it('reports a stale worker as offline', () => {
    expect(deriveLivePublicationState({ ...base, worker_heartbeat_at: '2026-08-26T11:58:00.000Z' }, now)).toBe('OFFLINE');
  });
});
