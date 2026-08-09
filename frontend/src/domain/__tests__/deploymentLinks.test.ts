import { describe, expect, it, vi } from 'vitest';
import { buildDeploymentAwareUrl, encodeDeploymentAwareQr } from '../deploymentLinks';

const origins = [
  'https://surfjudging.cloud',
  'https://test.surfjudging.cloud',
  'http://10.0.0.11:8080',
] as const;

describe('deployment-aware internal links', () => {
  it.each(origins)('keeps display, judge and priority on %s', (origin) => {
    expect(buildDeploymentAwareUrl(origin, '/display', { eventId: 28, podium: 'A' }))
      .toBe(`${origin}/display?eventId=28&podium=A`);
    expect(buildDeploymentAwareUrl(origin, '/judge', { eventId: 28, podium: 'A', position: 'J3' }))
      .toBe(`${origin}/judge?eventId=28&podium=A&position=J3`);
    expect(buildDeploymentAwareUrl(origin, '/priority', { eventId: 28, podium: 'A' }))
      .toBe(`${origin}/priority?eventId=28&podium=A`);
  });

  it.each([
    ['/display', '#1f1147'],
    ['/judge', '#3b0764'],
    ['/priority', '#312e81'],
  ] as const)('passes the actual %s URL to the QR encoder', async (route, color) => {
    const value = buildDeploymentAwareUrl('https://test.surfjudging.cloud', route, {
      eventId: 28,
      podium: 'A',
    });
    const encoder = vi.fn().mockResolvedValue('data:image/png;base64,qr');

    await expect(encodeDeploymentAwareQr(value, color, encoder)).resolves.toBe('data:image/png;base64,qr');
    expect(encoder).toHaveBeenCalledOnce();
    expect(encoder).toHaveBeenCalledWith(
      `https://test.surfjudging.cloud${route}?eventId=28&podium=A`,
      expect.objectContaining({ width: 220, margin: 1, color: { dark: color, light: '#ffffff' } }),
    );
  });
});
