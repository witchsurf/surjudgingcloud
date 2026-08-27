#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktop, '..');
const runtimeName = process.argv[2] || 'surfjudging_installer_payload_probe';
const source = path.join(repo, 'artifacts', 'runtimes', runtimeName);
const output = path.join(desktop, 'field-runtime');
const distField = path.join(repo, 'frontend', 'dist-field');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'config/p38-from-zero-manifest.json'), 'utf8'));
const schema = manifest.migrations.slice().sort((a, b) => a.order - b.order).at(-1).path.split('/').at(-1).replace(/\.sql$/, '');

export const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function normalizeCompose(text, sourceRuntime) {
  return text
    .replaceAll(sourceRuntime, 'surfjudging_field')
    .replace(/(["'])\d+:5432\1/g, (_match, quote) => `${quote}5432:5432${quote}`)
    .replace(/(["'])\d+:8000\1/g, (_match, quote) => `${quote}8000:8000${quote}`)
    .replace(/(["'])\d+:80\1/g, (_match, quote) => `${quote}8080:80${quote}`)
    .replace('image: supabase/postgres:15.1.0.147', 'image: surfjudging_field_postgres_img:latest')
    .replace(/test:\s*\["CMD-SHELL",\s*"pg_isready -U postgres -d postgres"\]/g,
      'test: ["CMD-SHELL", "/usr/local/bin/surfjudging-field-healthcheck.sh"]')
    .replace(/image:\s+surfjudging_field_frontend_img(?::latest)?/g, 'image: surfjudging_field_frontend_img:latest')
    .replace(/(\n  frontend:\n[\s\S]*?\n    restart: unless-stopped)(\n    ports:)/,
      '$1\n    depends_on:\n      kong:\n        condition: service_healthy$2');
}

export function normalizeFieldEnv(text, postgresPassword) {
  if (typeof postgresPassword !== 'string' || !/^[a-f0-9]{64}$/.test(postgresPassword)) {
    throw new Error('Field PostgreSQL password must be a generated 256-bit hex secret');
  }
  const replace = (key, value, input) => {
    const line = new RegExp(`^${key}=.*$`, 'm');
    return line.test(input) ? input.replace(line, `${key}=${value}`) : `${input.trimEnd()}\n${key}=${value}\n`;
  };
  return replace('SITE_URL', 'http://localhost:8080',
    replace('API_EXTERNAL_URL', 'http://localhost:8000',
      replace('REALTIME_TENANT_ID', 'surfjudging_field_realtime',
        replace('POSTGRES_PASSWORD', postgresPassword, text))));
}

export function createFrontendManifest(sourceManifest, expectedSchema) {
  const codeRevision = sourceManifest.gitCommit || sourceManifest.codeRevision || sourceManifest.sourceRevision;
  if (typeof codeRevision !== 'string' || !/^[a-f0-9]{7,40}$/i.test(codeRevision)) {
    throw new Error('Field frontend build has no valid source revision');
  }
  const releaseId = `surfjudging-field-${codeRevision.slice(0, 7)}`;
  return {
    deploymentMode: 'field',
    releaseId,
    codeRevision,
    sourceRevision: codeRevision,
    expectedSchemaVersion: expectedSchema,
    cloudTestActivationSupported: false,
    publicApiUrl: null,
    publicFrontendPort: 8080,
  };
}

export function createImageIndex(images) {
  return {
    format: 'docker-save-v1',
    images: images.map((image) => `${image.replaceAll(/[/:]/g, '_')}.tar`).sort(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });

for (const required of ['.env', 'docker-compose.yml', 'kong.yml', 'nginx.conf']) {
  if (!fs.existsSync(path.join(source, required))) throw new Error(`Runtime source missing: ${required}`);
}
if (!fs.existsSync(path.join(distField, 'deployment-manifest.json'))) {
  throw new Error('Current frontend/dist-field is missing; run the guarded Field build first');
}
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite payload: ${output}`);

fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'scripts'), { recursive: true });
for (const script of ['live-outbox-worker.mjs', 'start-surfjudging-field-mac.sh', 'start-surfjudging-field-windows.ps1']) {
  const sourceFile = script === 'live-outbox-worker.mjs'
    ? path.join(repo, 'scripts', script)
    : path.join(desktop, 'runtime-template', 'scripts', script);
  fs.copyFileSync(sourceFile, path.join(output, 'scripts', script));
}
fs.chmodSync(path.join(output, 'scripts', 'start-surfjudging-field-mac.sh'), 0o755);

const frontendManifest = createFrontendManifest(
  JSON.parse(fs.readFileSync(path.join(distField, 'deployment-manifest.json'), 'utf8')),
  schema,
);
const frontendRoot = path.join(output, 'frontend');
fs.cpSync(distField, path.join(frontendRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(frontendRoot, 'dist', 'deployment-manifest.json'), JSON.stringify(frontendManifest, null, 2));
fs.writeFileSync(path.join(frontendRoot, 'nginx.conf'), fs.readFileSync(path.join(source, 'nginx.conf'), 'utf8').replaceAll(runtimeName, 'surfjudging_field'));
fs.writeFileSync(path.join(frontendRoot, 'Dockerfile'), 'FROM nginx:alpine\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\nCOPY dist/ /usr/share/nginx/html/\n');

fs.mkdirSync(path.join(output, 'compose'), { recursive: true });
const compose = normalizeCompose(fs.readFileSync(path.join(source, 'docker-compose.yml'), 'utf8'), runtimeName);
fs.writeFileSync(path.join(output, 'compose', 'compose.yaml'), compose);
fs.writeFileSync(path.join(output, 'compose', '.env'), normalizeFieldEnv(
  fs.readFileSync(path.join(source, '.env'), 'utf8'),
  crypto.randomBytes(32).toString('hex'),
));
fs.writeFileSync(path.join(output, 'compose', 'kong.yml'), fs.readFileSync(path.join(source, 'kong.yml'), 'utf8').replaceAll(runtimeName, 'surfjudging_field'));

const init = path.join(output, 'database', 'init');
fs.cpSync(path.join(desktop, 'runtime-template', 'database'), path.join(output, 'database'), { recursive: true });
fs.copyFileSync(path.join(repo, 'backend/supabase/p38-canonical-baseline.sql'), path.join(init, 'baseline.sql'));
fs.mkdirSync(path.join(init, 'migrations'), { recursive: true });
for (const migration of manifest.migrations) fs.copyFileSync(path.join(repo, migration.path), path.join(init, 'migrations', path.basename(migration.path)));
const modeSql = path.join(init, 'field-mode.sql');
fs.writeFileSync(modeSql, fs.readFileSync(modeSql, 'utf8').replace('__SURFJUDGING_SCHEMA_VERSION__', schema));
const healthcheck = path.join(output, 'database', 'healthcheck.sh');
fs.writeFileSync(healthcheck, fs.readFileSync(healthcheck, 'utf8').replace('__SURFJUDGING_SCHEMA_VERSION__', schema));

run('docker', ['build', '-t', 'surfjudging_field_postgres_img:latest', path.join(output, 'database')]);
run('docker', ['build', '-t', 'surfjudging_field_frontend_img:latest', frontendRoot]);

const images = ['surfjudging_field_postgres_img:latest', 'surfjudging_field_frontend_img:latest', 'supabase/gotrue:v2.132.3', 'postgrest/postgrest:v11.2.0', 'supabase/realtime:v2.25.50', 'supabase/storage-api:v0.40.4', 'kong:2.8.1'];
fs.mkdirSync(path.join(output, 'images'), { recursive: true });
for (const image of images) run('docker', ['save', '-o', path.join(output, 'images', `${image.replaceAll(/[/:]/g, '_')}.tar`), image]);
fs.writeFileSync(path.join(output, 'images', 'index.json'), JSON.stringify(createImageIndex(images), null, 2));

const files = [
  'compose/compose.yaml', 'compose/.env', 'compose/kong.yml',
  'frontend/dist/deployment-manifest.json', 'database/init/baseline.sql', 'database/init/field-mode.sql',
  'database/init/service-roles.sql',
  'database/healthcheck.sh',
  'scripts/live-outbox-worker.mjs', 'scripts/start-surfjudging-field-mac.sh', 'scripts/start-surfjudging-field-windows.ps1',
  'images/index.json',
];
const runtimeManifest = {
  runtimeVersion: '0.1.0',
  composeVersion: '3.8',
  desktopVersion: '0.4.0',
  frontend: { releaseId: frontendManifest.releaseId, sourceRevision: frontendManifest.sourceRevision },
  services: Object.fromEntries(images.map((image) => [image, { image }])),
  schema: { expectedVersion: schema },
  files: Object.fromEntries(files.map((file) => [file, hashFile(path.join(output, file))])),
};
fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify(runtimeManifest, null, 2));
console.log(`PAYLOAD ASSEMBLED: ${output}`);
}
