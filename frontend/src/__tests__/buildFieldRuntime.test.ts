import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseEnvFile,
  computeSha256,
  runPreflightCheck,
  verifyBundleFingerprint,
// @ts-expect-error - Imported Node .mjs orchestrator helper
} from '../../../scripts/build-field-runtime.mjs';

describe('build-field-runtime orchestrator and security boundary', () => {
  const VALID_ANON_KEY =
    'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3ODczNTY4ODEsICJleHAiOiAyMTAyNzE2ODgxfQ.CJS3oOOVmcxQEJp-x-yIuA2MLjSgLc3keIJxDhKWD10';
  const STALE_OR_DIFFERENT_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODY3NjA0MDV9.R7dF61lzIX8Zj2AQxZVQ2cltHnjQX0t-I1QckuSNLyA';

  const tempTestDir = path.resolve(__dirname, '../../test-temp-build-verify');
  const tempAssetsDir = path.join(tempTestDir, 'assets');

  beforeEach(() => {
    fs.mkdirSync(tempAssetsDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempTestDir)) {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('(A) runtime key == bundle key => PASS', () => {
    // Write mock bundle chunk containing the exact runtime anon key
    fs.writeFileSync(
      path.join(tempAssetsDir, 'supabase-chunk-123.js'),
      `export const key = "${VALID_ANON_KEY}";`
    );

    const result = verifyBundleFingerprint(tempTestDir, VALID_ANON_KEY, 'http://localhost:18400');
    expect(result.matched).toBe(true);
    expect(result.fingerprint).toBe(computeSha256(VALID_ANON_KEY));
    expect(result.shortFingerprint).toBe(computeSha256(VALID_ANON_KEY).slice(0, 12));
  });

  it('(B) runtime key != bundle key => BUILD FAIL', () => {
    // Write mock bundle chunk containing a stale/different key
    fs.writeFileSync(
      path.join(tempAssetsDir, 'supabase-chunk-123.js'),
      `export const key = "${STALE_OR_DIFFERENT_ANON_KEY}";`
    );

    expect(() => {
      verifyBundleFingerprint(tempTestDir, VALID_ANON_KEY, 'http://localhost:18400');
    }).toThrow(/Bundle fingerprint mismatch/);
  });

  it('(C) runtime key invalid => PREFLIGHT FAIL BEFORE VITE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"message":"JWSError JWSInvalidSignature"}',
    });
    globalThis.fetch = fetchMock;

    await expect(
      runPreflightCheck('http://localhost:18400', 'invalid.key.token')
    ).rejects.toThrow(/Preflight rejected by Supabase.*401/);
  });

  it('(D) runtime .env absent => BUILD FAIL', () => {
    expect(() => {
      parseEnvFile('/non/existent/runtime/.env');
    }).toThrow(/Runtime \.env file not found/);
  });

  it('(E) URL absente => PREFLIGHT FAIL', async () => {
    await expect(runPreflightCheck('', VALID_ANON_KEY)).rejects.toThrow(
      /Supabase URL is missing/
    );
  });

  it('(F) parseEnvFile correctly extracts keys from runtime .env and handles comments/quotes', () => {
    const mockEnvPath = path.join(tempTestDir, 'mock.env');
    fs.writeFileSync(
      mockEnvPath,
      `
# Comment
ANON_KEY="${VALID_ANON_KEY}"
API_EXTERNAL_URL='http://localhost:18400'
SITE_URL=http://localhost:18480
`
    );

    const parsed = parseEnvFile(mockEnvPath);
    expect(parsed.ANON_KEY).toBe(VALID_ANON_KEY);
    expect(parsed.API_EXTERNAL_URL).toBe('http://localhost:18400');
    expect(parsed.SITE_URL).toBe('http://localhost:18480');
  });

  it('(G) computeSha256 produces deterministic hex hash without leaking secrets', () => {
    const hash = computeSha256(VALID_ANON_KEY);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('eyJ');
  });

  it('(H) preflight check passes on 200 OK response from PostgREST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 10004 }],
    });
    globalThis.fetch = fetchMock;

    const result = await runPreflightCheck('http://localhost:18400', VALID_ANON_KEY);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:18400/rest/v1/events?select=id&limit=1',
      expect.objectContaining({
        headers: {
          apikey: VALID_ANON_KEY,
          Authorization: `Bearer ${VALID_ANON_KEY}`,
          Accept: 'application/json',
        },
      })
    );
  });
});
