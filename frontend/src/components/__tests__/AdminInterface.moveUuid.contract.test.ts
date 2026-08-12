import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const adminInterfacePath = path.resolve(__dirname, '..', 'AdminInterface.tsx');
const adminInterfaceSource = fs.readFileSync(adminInterfacePath, 'utf8');

describe('AdminInterface chief judge move UUID contract', () => {
  it('does not call crypto.randomUUID directly in the move workflow', () => {
    expect(adminInterfaceSource).not.toContain('id: crypto.randomUUID()');
  });

  it('uses the shared UUID helper instead', () => {
    expect(adminInterfaceSource).toContain('generateUuidV4()');
  });
});
