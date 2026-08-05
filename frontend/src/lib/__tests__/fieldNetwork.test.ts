import { describe, expect, it } from 'vitest';
import { buildFieldNetworkInfo, FIELD_ROUTES, isAllowedFieldNetworkUrl } from '../fieldNetwork';

describe('field network URLs', () => {
  it('builds the official LAN routes without inventing /chief', () => {
    const info = buildFieldNetworkInfo(
      { protocol: 'http:', hostname: '192.168.1.2', port: '8080', origin: 'http://192.168.1.2:8080' },
      'http://192.168.1.2:8000',
    );

    expect(FIELD_ROUTES).toEqual({
      chief: '/admin',
      chiefLegacy: '/chief-judge',
      judge: '/judge',
      priority: '/priority',
      display: '/display',
    });
    expect(info).toMatchObject({
      hostname: '192.168.1.2',
      frontendPort: '8080',
      chiefUrl: 'http://192.168.1.2:8080/admin',
      chiefLegacyUrl: 'http://192.168.1.2:8080/chief-judge',
      judgeUrl: 'http://192.168.1.2:8080/judge',
      priorityUrl: 'http://192.168.1.2:8080/priority',
      displayUrl: 'http://192.168.1.2:8080/display',
      supabaseUrl: 'http://192.168.1.2:8000',
      esp32Url: 'http://priority.local',
    });
  });

  it.each([
    'http://192.168.1.2:8080/admin',
    'http://192.168.1.2:8000/rest/v1/events',
    'ws://192.168.1.2:8000/realtime/v1/websocket',
    'http://localhost:54321/rest/v1/events',
    'http://127.0.0.1:4173/assets/app.js',
    'http://priority.local/',
    'blob:http://192.168.1.2:8080/id',
    'data:image/svg+xml;base64,AAA',
  ])('allows field-local URL %s', (url) => {
    expect(isAllowedFieldNetworkUrl(url, 'http://192.168.1.2:8080', 'http://192.168.1.2:8000')).toBe(true);
  });

  it.each([
    'https://project.supabase.co/rest/v1/events',
    'https://docs.google.com/spreadsheets/d/id/export',
    'https://api.stripe.com/v1/balance',
    'https://images.unsplash.com/photo.jpg',
    'https://example.org/resource.js',
  ])('rejects public URL %s', (url) => {
    expect(isAllowedFieldNetworkUrl(url, 'http://192.168.1.2:8080', 'http://192.168.1.2:8000')).toBe(false);
  });
});
