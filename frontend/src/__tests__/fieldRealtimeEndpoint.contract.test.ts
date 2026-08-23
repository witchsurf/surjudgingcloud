import { describe, it, expect, vi } from 'vitest';
import { runPreflightCheck } from '../../../scripts/build-field-runtime.mjs';

describe('P3.8 — Field Realtime and Key Preflight Contracts', () => {
  const VALID_ANON_KEY =
    'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3ODczNTY4ODEsICJleHAiOiAyMTAyNzE2ODgxfQ.CJS3oOOVmcxQEJp-x-yIuA2MLjSgLc3keIJxDhKWD10';

  it('rejects preflight when REST endpoint returns 401/403/500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"message":"JWSError JWSInvalidSignature"}',
    });
    globalThis.fetch = fetchMock;

    await expect(
      runPreflightCheck('http://localhost:18400', 'wrong-key')
    ).rejects.toThrow(/Preflight rejected by Supabase.*401/);
  });

  it('passes preflight when REST endpoint returns 200 OK', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 10004 }],
    });
    globalThis.fetch = fetchMock;

    const result = await runPreflightCheck('http://localhost:18400', VALID_ANON_KEY);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });
});
