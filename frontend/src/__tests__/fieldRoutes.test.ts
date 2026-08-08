import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('P1 field route contract', () => {
  it.each(['/admin', '/chief-judge', '/judge', '/priority', '/display', '/overlay'])(
    'keeps route %s',
    (route) => expect(appSource).toContain(`path="${route}"`),
  );

  it('does not add a /chief route', () => {
    expect(appSource).not.toMatch(/path=["']\/chief["']/);
  });

  it('keeps the legacy chief route redirecting to /admin', () => {
    const legacyBlock = appSource.slice(appSource.indexOf('path="/chief-judge"'), appSource.indexOf('{/* Judge Routes */}'));
    expect(legacyBlock).toContain('to="/admin"');
  });
});
