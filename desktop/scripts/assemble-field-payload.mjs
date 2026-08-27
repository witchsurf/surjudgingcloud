#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const desktop = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = path.resolve(desktop, '..');
const runtimeName = process.argv[2] || 'surfjudging_installer_payload_probe';
const source = path.join(repo, 'artifacts', 'runtimes', runtimeName);
const output = path.join(desktop, 'field-runtime');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'config/p38-from-zero-manifest.json'), 'utf8'));
const schema = manifest.migrations.slice().sort((a,b) => a.order - b.order).at(-1).path.split('/').at(-1).replace(/\.sql$/, '');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });

for (const required of ['.env', 'docker-compose.yml', 'kong.yml', 'nginx.conf', 'dist/deployment-manifest.json']) {
  if (!fs.existsSync(path.join(source, required))) throw new Error(`Runtime source missing: ${required}`);
}
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite payload: ${output}`);

fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(repo, 'scripts', 'live-outbox-worker.mjs'), path.join(output, 'scripts', 'live-outbox-worker.mjs'));
fs.cpSync(path.join(source, 'dist'), path.join(output, 'frontend', 'dist'), { recursive: true });
fs.mkdirSync(path.join(output, 'compose'), { recursive: true });
let compose = fs.readFileSync(path.join(source, 'docker-compose.yml'), 'utf8')
  .replaceAll(runtimeName, 'surfjudging_field')
  .replaceAll('19400:8000', '8000:8000').replaceAll('19480:80', '8080:80').replaceAll('19432:5432', '5432:5432');
compose = compose.replace('image: supabase/postgres:15.1.0.147', 'image: surfjudging_field_postgres_img:latest');
fs.writeFileSync(path.join(output, 'compose', 'compose.yaml'), compose);
for (const name of ['.env', 'kong.yml', 'nginx.conf']) fs.copyFileSync(path.join(source, name), path.join(output, 'compose', name));

const init = path.join(output, 'database', 'init');
fs.cpSync(path.join(desktop, 'runtime-template', 'database'), path.join(output, 'database'), { recursive: true });
fs.copyFileSync(path.join(repo, 'backend/supabase/p38-canonical-baseline.sql'), path.join(init, 'baseline.sql'));
fs.mkdirSync(path.join(init, 'migrations'), { recursive: true });
for (const migration of manifest.migrations) fs.copyFileSync(path.join(repo, migration.path), path.join(init, 'migrations', path.basename(migration.path)));
const modeSql = path.join(init, 'field-mode.sql');
fs.writeFileSync(modeSql, fs.readFileSync(modeSql, 'utf8').replace('__SURFJUDGING_SCHEMA_VERSION__', schema));
run('docker', ['build', '-t', 'surfjudging_field_postgres_img:latest', path.join(output, 'database')]);
run('docker', ['tag', `${runtimeName}_frontend_img:latest`, 'surfjudging_field_frontend_img:latest']);
compose = fs.readFileSync(path.join(output, 'compose', 'compose.yaml'), 'utf8').replace(`${runtimeName}_frontend_img`, 'surfjudging_field_frontend_img');
fs.writeFileSync(path.join(output, 'compose', 'compose.yaml'), compose);

const images = ['surfjudging_field_postgres_img:latest', 'surfjudging_field_frontend_img:latest', 'supabase/gotrue:v2.132.3', 'postgrest/postgrest:v11.2.0', 'supabase/realtime:v2.25.50', 'supabase/storage-api:v0.40.4', 'kong:2.8.1'];
fs.mkdirSync(path.join(output, 'images'), { recursive: true });
for (const image of images) run('docker', ['save', '-o', path.join(output, 'images', `${image.replaceAll(/[/:]/g, '_')}.tar`), image]);
const files = ['compose/compose.yaml', 'compose/.env', 'frontend/dist/deployment-manifest.json', 'database/init/baseline.sql', 'database/init/field-mode.sql', 'scripts/live-outbox-worker.mjs'];
fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify({ runtimeVersion:'0.1.0', composeVersion:'3.8', desktopVersion:'0.4.0', frontend:JSON.parse(fs.readFileSync(path.join(source, 'deployment-manifest.json'))), services:Object.fromEntries(images.map(image => [image, { image }])), schema:{ expectedVersion:schema }, files:Object.fromEntries(files.map(file => [file, hash(path.join(output, file))])) }, null, 2));
console.log(`PAYLOAD ASSEMBLED: ${output}`);
