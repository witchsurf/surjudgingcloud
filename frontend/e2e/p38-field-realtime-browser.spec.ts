import { test, expect } from '@playwright/test';

test.describe('P3.8 — Real Browser Realtime Forensic & Field Same-Origin Verification', () => {
  const BASE_URL = 'http://192.168.1.107:18480';
  const FORBIDDEN_CONSOLE_PATTERNS = [
    /CHANNEL_ERROR/i,
    /TIMED_OUT/i,
    /WebSocket .* failed/i,
    /ReferenceError/i,
    /PGRST301/i,
    /JWSInvalidSignature/i,
    /p38_test2_disposable_open_r1_h1/i,
  ];

  test('Display page connects to same-origin Realtime WebSocket without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const wsUrls: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      for (const pattern of FORBIDDEN_CONSOLE_PATTERNS) {
        if (pattern.test(text)) {
          consoleErrors.push(`[Console ${msg.type()}]: ${text}`);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(`[PageError]: ${err.message}`);
    });

    page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
    });

    // Step 1: Visit Admin to ensure heat is saved/active
    await page.goto(`${BASE_URL}/admin?eventId=10004&podium=A`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Step 2: Visit Display
    const targetUrl = `${BASE_URL}/display?eventId=10004&podium=A`;
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle' });

    expect(response?.status()).toBe(200);

    // Give time for Realtime subscription to establish
    await page.waitForTimeout(3000);

    // Verify WebSocket connected to port 18480
    expect(wsUrls.length).toBeGreaterThan(0);
    expect(wsUrls.some((url) => url.includes('18480/realtime/v1/websocket'))).toBe(true);

    // Check no forbidden errors occurred
    expect(consoleErrors).toEqual([]);
  });

  test('Judge J1 page connects to same-origin Realtime WebSocket without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const wsUrls: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      for (const pattern of FORBIDDEN_CONSOLE_PATTERNS) {
        if (pattern.test(text)) {
          consoleErrors.push(`[Console ${msg.type()}]: ${text}`);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(`[PageError]: ${err.message}`);
    });

    page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
    });

    const targetUrl = `${BASE_URL}/judge?eventId=10004&podium=A&position=J1`;
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle' });

    expect(response?.status()).toBe(200);

    // Give time for Realtime subscription to establish
    await page.waitForTimeout(3000);

    // Verify WebSocket connected to port 18480
    expect(wsUrls.length).toBeGreaterThan(0);
    expect(wsUrls.some((url) => url.includes('18480/realtime/v1/websocket'))).toBe(true);

    // Check no forbidden errors occurred
    expect(consoleErrors).toEqual([]);
  });
});
