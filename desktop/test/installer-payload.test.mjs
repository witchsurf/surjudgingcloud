import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontendManifest, createImageIndex, normalizeCompose, normalizeFieldEnv } from '../scripts/assemble-field-payload.mjs';

test('normalizes disposable runtime names and host ports', () => {
  const result = normalizeCompose(`container_name: p38_frontend\nports:\n  - "18432:5432"\n  - "18400:8000"\n  - "18480:80"\nimage: p38_frontend_img\n`, 'p38');
  assert.match(result, /surfjudging_field_frontend/);
  assert.match(result, /"5432:5432"/);
  assert.match(result, /"8000:8000"/);
  assert.match(result, /"8080:80"/);
  assert.match(result, /image: surfjudging_field_frontend_img:latest/);
  assert.doesNotMatch(result, /184(?:00|32|80)/);
});

test('normalizes public auth and site URLs without touching secrets', () => {
  const result = normalizeFieldEnv('POSTGRES_PASSWORD=keep-me\nAPI_EXTERNAL_URL=http://localhost:18400\nSITE_URL=http://localhost:18480\n');
  assert.match(result, /^API_EXTERNAL_URL=http:\/\/localhost:8000$/m);
  assert.match(result, /^SITE_URL=http:\/\/localhost:8080$/m);
  assert.match(result, /^POSTGRES_PASSWORD=keep-me$/m);
});

test('creates a complete fail-closed Field frontend identity', () => {
  const revision = 'e786c19476f818c490f37619ce88b718d4e08301';
  const result = createFrontendManifest({ gitCommit: revision }, '20260827161500_guard');
  assert.deepEqual(result, {
    deploymentMode: 'field',
    releaseId: 'surfjudging-field-e786c19',
    codeRevision: revision,
    sourceRevision: revision,
    expectedSchemaVersion: '20260827161500_guard',
    cloudTestActivationSupported: false,
    publicApiUrl: null,
    publicFrontendPort: 8080,
  });
  assert.throws(() => createFrontendManifest({ gitCommit: 'unknown' }, 'schema'), /valid source revision/);
});

test('creates a deterministic Docker image archive index', () => {
  assert.deepEqual(createImageIndex(['z/image:1', 'a/image:2']), {
    format: 'docker-save-v1',
    images: ['a_image_2.tar', 'z_image_1.tar'],
  });
});
