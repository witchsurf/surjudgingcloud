import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc },
}));

import {
  activateEventForTest,
  canActivateEventForTest,
  createEventSecure,
} from '../eventCreation.api';

const request = {
  name: 'Competition X',
  organizer: 'DTN',
  startDate: '2026-08-09',
  endDate: '2026-08-10',
  price: 0,
  currency: 'XOF',
  categories: ['OPEN'],
  judges: [],
};

describe('secure dual-mode event creation adapter', () => {
  beforeEach(() => rpc.mockReset());

  it('uses only the narrow RPC payload and maps its bigint ID', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: '42', name: request.name, organizer: request.organizer,
        start_date: request.startDate, end_date: request.endDate,
        price: 0, currency: 'XOF', method: null, status: 'pending', paid: false,
        paid_at: null, payment_ref: null, categories: ['OPEN'], judges: [],
        user_id: null, created_at: '2026-08-09T12:00:00Z',
      }],
      error: null,
    });

    await expect(createEventSecure(request)).resolves.toMatchObject({ id: 42, paid: false });
    expect(rpc).toHaveBeenCalledWith('create_event_secure', {
      p_name: request.name,
      p_organizer: request.organizer,
      p_start_date: request.startDate,
      p_end_date: request.endDate,
      p_price: 0,
      p_currency: 'XOF',
      p_categories: ['OPEN'],
      p_judges: [],
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('id');
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('user_id');
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('owner_id');
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('paid');
  });

  it('propagates an RPC refusal without falling back to a direct insert', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'CLOUD_AUTH_REQUIRED' } });
    await expect(createEventSecure(request)).rejects.toThrow('CLOUD_AUTH_REQUIRED');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects missing dates before calling the database', async () => {
    await expect(createEventSecure({ ...request, startDate: '', endDate: '' }))
      .rejects.toThrow('Les dates de début et de fin sont requises.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unsafe or missing canonical ID', async () => {
    rpc.mockResolvedValue({
      data: [{ ...request, id: 'not-a-bigint', start_date: request.startDate, end_date: request.endDate,
        method: null, status: 'pending', paid: false, paid_at: null, payment_ref: null,
        user_id: null, created_at: '2026-08-09T12:00:00Z' }],
      error: null,
    });
    await expect(createEventSecure(request)).rejects.toThrow(/ID d’événement canonique/);
  });

  it('reads the server-owned Cloud test capability', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(canActivateEventForTest(42)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_event_test_activation_capability', { p_event_id: 42 });
  });

  it('activates through the narrow RPC and maps its audit record', async () => {
    rpc.mockResolvedValue({
      data: [{
        event_id: 42,
        test_activated_at: '2026-08-09T12:00:00Z',
        test_activated_by: 'owner-1',
      }],
      error: null,
    });
    await expect(activateEventForTest(42)).resolves.toEqual({
      eventId: 42,
      testActivatedAt: '2026-08-09T12:00:00Z',
      testActivatedBy: 'owner-1',
    });
    expect(rpc).toHaveBeenCalledWith('activate_event_for_test', { p_event_id: 42 });
  });

  it('propagates a disabled activation without direct event update', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'CLOUD_TEST_ACTIVATION_DISABLED' } });
    await expect(activateEventForTest(42)).rejects.toThrow('CLOUD_TEST_ACTIVATION_DISABLED');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
