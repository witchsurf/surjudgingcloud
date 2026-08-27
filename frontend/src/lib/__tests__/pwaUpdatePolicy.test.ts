import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldAutoApplyPwaUpdate } from '../pwaUpdatePolicy';

describe('PWA update safety policy', () => {
  it.each(['/', '/landing', '/landing/'])('allows automatic activation on passive route %s', (path) => {
    expect(shouldAutoApplyPwaUpdate(path)).toBe(true);
  });

  it.each([
    '/admin',
    '/judge',
    '/priority',
    '/display',
    '/overlay',
    '/live-overlay',
    '/participants',
    '/generate-heats',
    '/my-events',
    '/login',
  ])('defers automatic activation on operational route %s', (path) => {
    expect(shouldAutoApplyPwaUpdate(path)).toBe(false);
  });

  it('builds a waiting worker instead of an auto-reloading worker', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain("disable: deploymentMode === 'field'");
    expect(viteConfig).toContain("registerType: 'prompt'");
    expect(viteConfig).toContain('skipWaiting: false');
    expect(viteConfig).toContain('clientsClaim: false');
    expect(viteConfig).not.toContain("registerType: 'autoUpdate'");
  });

  it('guards service-worker activation with the safe-route policy', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(mainSource).toContain('shouldAutoApplyPwaUpdate(window.location.pathname)');
    expect(mainSource).toContain('activation différée pour protéger l’écran opérationnel');
  });
});
