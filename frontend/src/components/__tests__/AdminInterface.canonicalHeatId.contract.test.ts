import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readAdminInterface = () =>
  readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');

const readAdminPage = () =>
  readFileSync(resolve(process.cwd(), 'src/pages/AdminPage.tsx'), 'utf8');

describe('AdminInterface canonical heat id contract', () => {
  it('accepts a canonicalHeatId prop and prefers it over the fallback UI heat key', () => {
    const source = readAdminInterface();

    expect(source).toContain('canonicalHeatId?: string;');
    expect(source).toContain("() => ensureHeatId(canonicalHeatId || fallbackHeatId)");
  });

  it('blocks premature heat-scoped DB reads when the admin context is not canonical yet', () => {
    const source = readAdminInterface();

    expect(source).toContain('const hasCanonicalHeatContext = React.useMemo(');
    expect(source).toContain("heatId !== 'r1_h1'");
    expect(source).toContain('if (!hasCanonicalHeatContext) {');
  });

  it('subscribes admin score hydration to canonical heat score events', () => {
    const source = readAdminInterface();

    expect(source).toContain('subscribeToHeatScores');
    expect(source).toContain("subscribeToHeatScores(heatId, () => { void loadDbScores(); })");
  });

  it('passes the page-level canonical heat id down into AdminInterface', () => {
    const source = readAdminPage();

    expect(source).toContain('<AdminInterface');
    expect(source).toContain('canonicalHeatId={currentHeatId}');
  });
});
