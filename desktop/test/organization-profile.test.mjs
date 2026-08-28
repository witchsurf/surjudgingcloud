import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import profileModule from '../src/main/organization-profile.cjs';

const { normalizeOrganizationName, decodePngDataUrl, readOrganizationProfile, saveOrganizationProfile } = profileModule;
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('organization name is normalized and bounded', () => {
  assert.equal(normalizeOrganizationName('  Fédération   Sénégalaise  '), 'Fédération Sénégalaise');
  assert.throws(() => normalizeOrganizationName('x'), /2 et 120/);
});

test('logo validation rejects non PNG input', () => {
  assert.throws(() => decodePngDataUrl('data:image/jpeg;base64,AAAA'), /PNG/);
});

test('organization profile persists atomically and reloads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surfjudging-org-'));
  const saved = await saveOrganizationProfile(root, { organizationName: 'Surf Sénégal', logoDataUrl: tinyPng });
  assert.equal(saved.configured, true);
  assert.equal(saved.organizationName, 'Surf Sénégal');
  assert.equal((await readOrganizationProfile(root)).logoDataUrl, tinyPng);
});
