import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createFrontendManifest, createImageIndex, createImageLoadPlan, normalizeCompose, normalizeFieldEnv } from '../scripts/assemble-field-payload.mjs';

test('normalizes disposable runtime names and host ports', () => {
  const result = normalizeCompose(`services:\n  postgres:\n    ports:\n      - "18432:5432"\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]\n  api:\n    ports:\n      - "18400:8000"\n  frontend:\n    image: p38_frontend_img\n    container_name: p38_frontend\n    restart: unless-stopped\n    ports:\n      - "18480:80"\n`, 'p38');
  assert.match(result, /surfjudging_field_frontend/);
  assert.match(result, /"5432:5432"/);
  assert.match(result, /"8000:8000"/);
  assert.match(result, /"8080:80"/);
  assert.match(result, /image: surfjudging_field_frontend_img:latest/);
  assert.match(result, /surfjudging-field-healthcheck\.sh/);
  assert.match(result, /frontend:[\s\S]*depends_on:\n      kong:\n        condition: service_healthy/);
  assert.match(result, /frontend:[\s\S]*environment:\n      ANON_KEY: \$\{ANON_KEY\}/);
  assert.doesNotMatch(result, /184(?:00|32|80)/);
});

test('injects the persistent Field anonymous key at frontend container startup', () => {
  const assembler = fs.readFileSync(path.resolve('scripts/assemble-field-payload.mjs'), 'utf8');
  const index = fs.readFileSync(path.resolve('../frontend/index.html'), 'utf8');
  assert.match(assembler, /runtime-config\.js\.template/);
  assert.match(assembler, /__SURFJUDGING_RUNTIME_CONFIG__/);
  assert.match(assembler, /NGINX_ENVSUBST_OUTPUT_DIR=\/usr\/share\/nginx\/html/);
  assert.match(index, /<script src="\/runtime-config\.js"><\/script>/);
});

test('stages Kong configuration in a Docker volume without host bind mounts', () => {
  const result = normalizeCompose(`services:\n  kong:\n    volumes:\n      - ./kong.yml:/var/lib/kong/kong.yml:ro\nvolumes:\n  postgres-data:\n`, 'p38');
  assert.match(result, /surfjudging_field_kong_config:\n    external: true\n    name: surfjudging_field_kong_config/);
  assert.match(result, /- surfjudging_field_kong_config:\/var\/lib\/kong:ro/);
  assert.doesNotMatch(result, /\.\/kong\.yml/);
});

test('normalizes URLs, rotates the database secret and preserves JWT identity', () => {
  const generated = 'a'.repeat(64);
  const result = normalizeFieldEnv('POSTGRES_PASSWORD=source-secret\nJWT_SECRET=keep-me\nREALTIME_TENANT_ID=p38_realtime\nAPI_EXTERNAL_URL=http://localhost:18400\nSITE_URL=http://localhost:18480\n', generated);
  assert.match(result, /^API_EXTERNAL_URL=http:\/\/localhost:8000$/m);
  assert.match(result, /^SITE_URL=http:\/\/localhost:8080$/m);
  assert.match(result, new RegExp(`^POSTGRES_PASSWORD=${generated}$`, 'm'));
  assert.match(result, /^JWT_SECRET=keep-me$/m);
  assert.match(result, /^REALTIME_TENANT_ID=surfjudging_field_realtime$/m);
  assert.doesNotMatch(result, /p38_realtime/);
  assert.doesNotMatch(result, /source-secret/);
  assert.throws(() => normalizeFieldEnv('', 'short'), /256-bit/);
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

test('creates a deterministic archive-to-image load plan', () => {
  assert.equal(createImageLoadPlan(['z/image:1', 'a/image:2']), 'a_image_2.tar\ta/image:2\nz_image_1.tar\tz/image:1\n');
});

test('installs a top-level PostgreSQL entrypoint launcher for fresh volumes', () => {
  const dockerfile = fs.readFileSync(path.resolve('runtime-template/database/Dockerfile'), 'utf8');
  const launcher = fs.readFileSync(path.resolve('runtime-template/database/init/zz-surfjudging-field.sh'), 'utf8');
  const roles = fs.readFileSync(path.resolve('runtime-template/database/init/service-roles.sql'), 'utf8');
  const healthcheck = fs.readFileSync(path.resolve('runtime-template/database/healthcheck.sh'), 'utf8');
  assert.match(dockerfile, /COPY init\/zz-surfjudging-field\.sh \/docker-entrypoint-initdb\.d\/zz-surfjudging-field\.sh/);
  assert.match(dockerfile, /chmod 0755 \/docker-entrypoint-initdb\.d\/zz-surfjudging-field\.sh/);
  assert.match(launcher, /-v field_postgres_password="\$POSTGRES_PASSWORD"/);
  assert.match(launcher, /PGPASSWORD="\$POSTGRES_PASSWORD" psql/);
  assert.match(launcher, /-U supabase_admin/);
  for (const role of ['authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_admin', 'postgres']) {
    assert.match(roles, new RegExp(`ALTER ROLE ${role} WITH PASSWORD :\\'field_postgres_password\\'`));
  }
  assert.match(roles, /SET log_min_error_statement = PANIC/);
  assert.match(roles, /CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin/);
  assert.match(healthcheck, /__SURFJUDGING_SCHEMA_VERSION__/);
});

test('Field migration manifest includes planning V5 and the best-eliminated correction', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('../config/p38-from-zero-manifest.json'), 'utf8'));
  const provider = 'backend/supabase/migrations/20260826200000_require_explicit_progression_edges.sql';
  const marker = 'backend/supabase/migrations/20260826210000_align_runtime_schema_version_after_progression_guard.sql';
  const repair = 'backend/supabase/migrations/20260829083000_restore_field_planning_v5_contract.sql';
  const idempotentEventCreation = 'backend/supabase/migrations/20260901210000_idempotent_event_creation.sql';
  const bestEliminated = 'backend/supabase/migrations/20260902090000_allow_best_eliminated_placeholder_mappings.sql';
  const paths = manifest.migrations.map((migration) => migration.path);
  assert.ok(paths.indexOf(provider) >= 0, 'planning V5 provider is required');
  assert.ok(paths.indexOf(provider) < paths.indexOf(marker), 'planning V5 must precede its schema marker');
  assert.ok(paths.indexOf(repair) < paths.indexOf(idempotentEventCreation), 'planning V5 repair must precede event idempotency');
  assert.ok(paths.indexOf(idempotentEventCreation) < paths.indexOf(bestEliminated), 'best-eliminated correction must follow event idempotency');
  assert.equal(paths.at(-1), bestEliminated, 'best-eliminated correction must remain the Field target schema');
  for (const required of [provider, repair, bestEliminated]) {
    const entry = manifest.migrations.find((migration) => migration.path === required);
    const source = fs.readFileSync(path.resolve('..', required));
    assert.equal(entry.required, true);
    assert.equal(entry.sha256, crypto.createHash('sha256').update(source).digest('hex'));
    assert.match(source.toString('utf8'), /create or replace function public\.bulk_upsert_heats_safe_v5/);
  }
  const idempotencyEntry = manifest.migrations.find((migration) => migration.path === idempotentEventCreation);
  const idempotencySource = fs.readFileSync(path.resolve('..', idempotentEventCreation));
  assert.equal(idempotencyEntry.required, true);
  assert.equal(idempotencyEntry.sha256, crypto.createHash('sha256').update(idempotencySource).digest('hex'));
  assert.match(idempotencySource.toString('utf8'), /event_creation_requests/);
  assert.match(idempotencySource.toString('utf8'), /EVENT_NAME_ALREADY_EXISTS/);
});

test('existing Field databases use an ordered fail-closed migration path', () => {
  const macLauncher = fs.readFileSync(path.resolve('runtime-template/scripts/start-surfjudging-field-mac.sh'), 'utf8');
  const macUpgrade = fs.readFileSync(path.resolve('runtime-template/scripts/upgrade-field-database-mac.sh'), 'utf8');
  const windowsLauncher = fs.readFileSync(path.resolve('runtime-template/scripts/start-surfjudging-field-windows.ps1'), 'utf8');
  const windowsUpgrade = fs.readFileSync(path.resolve('runtime-template/scripts/upgrade-field-database-windows.ps1'), 'utf8');
  assert.match(macLauncher, /database-upgrade-check/);
  assert.doesNotMatch(macLauncher, /image inspect/);
  assert.match(macLauncher, /docker_bin" load -i/);
  assert.match(macUpgrade, /Unsupported Field schema upgrade source/);
  assert.match(macUpgrade, /database-upgrade-complete/);
  assert.match(macUpgrade, /psql -v ON_ERROR_STOP=1/);
  assert.match(macUpgrade, /SURFJUDGING_POSTGRES_CONTAINER/);
  assert.match(windowsLauncher, /database-upgrade-check/);
  assert.doesNotMatch(windowsLauncher, /image inspect/);
  assert.match(windowsLauncher, /docker load -i/);
  assert.match(windowsLauncher, /Publish-FileAtomically/);
  assert.match(windowsUpgrade, /Unsupported Field schema upgrade source/);
  assert.match(windowsUpgrade, /database-upgrade-complete/);
  assert.match(windowsUpgrade, /SURFJUDGING_POSTGRES_CONTAINER/);
  assert.match(windowsUpgrade, /docker cp/);
  assert.match(windowsUpgrade, /psql -v ON_ERROR_STOP=1/);
  assert.doesNotMatch(windowsUpgrade, /Get-Content \$migration\.FullName -Raw \|/);
});
