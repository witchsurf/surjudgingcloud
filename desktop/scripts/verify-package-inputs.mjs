#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateRuntimeManifest } = await import('../src/shared/runtime.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const runtime = path.join(root, 'field-runtime');
const required = [
  'runtime-manifest.json',
  'compose/compose.yaml',
  'compose/.env',
  'frontend/dist/deployment-manifest.json',
  'database/init/service-roles.sql',
  'database/healthcheck.sh',
  'images/index.json',
  'images/load-plan.tsv',
  'scripts/live-outbox-worker.mjs',
  'scripts/start-surfjudging-field-mac.sh',
  'scripts/start-surfjudging-field-windows.ps1'
];
const missing = required.filter((file) => !fs.existsSync(path.join(runtime, file)));
if (missing.length) throw new Error(`Packaging blocked: Field runtime is incomplete (${missing.join(', ')})`);
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime-manifest.json'), 'utf8'));
const validation = validateRuntimeManifest(manifest);
if (!validation.valid) throw new Error(`Packaging blocked: invalid runtime manifest (${validation.reasons.join(', ')})`);
const packageJson = require(path.join(root, 'package.json'));
if (!manifest.desktopVersion || manifest.desktopVersion !== packageJson.version) throw new Error('Packaging blocked: runtime desktopVersion does not match desktop package version');
const frontend = JSON.parse(fs.readFileSync(path.join(runtime, 'frontend/dist/deployment-manifest.json'), 'utf8'));
if (frontend.deploymentMode !== 'field') throw new Error('Packaging blocked: frontend deploymentMode is not field');
if (!frontend.releaseId || !frontend.codeRevision || !frontend.expectedSchemaVersion) throw new Error('Packaging blocked: frontend release identity is incomplete');
if (manifest.frontend?.releaseId !== frontend.releaseId || manifest.frontend?.sourceRevision !== frontend.codeRevision) throw new Error('Packaging blocked: runtime/frontend release identity mismatch');
if (manifest.schema?.expectedVersion !== frontend.expectedSchemaVersion) throw new Error('Packaging blocked: runtime/frontend schema mismatch');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [file, expected] of Object.entries(manifest.files || {})) {
  const target = path.join(runtime, file);
  if (!fs.existsSync(target) || hash(target) !== expected) throw new Error(`Packaging blocked: payload hash mismatch (${file})`);
}
const imageIndex = JSON.parse(fs.readFileSync(path.join(runtime, 'images/index.json'), 'utf8'));
if (imageIndex.format !== 'docker-save-v1' || !Array.isArray(imageIndex.images) || imageIndex.images.length !== Object.keys(manifest.services || {}).length) throw new Error('Packaging blocked: invalid image index');
for (const archive of imageIndex.images) {
  if (!/^[A-Za-z0-9_.-]+\.tar$/.test(archive) || !fs.existsSync(path.join(runtime, 'images', archive))) throw new Error(`Packaging blocked: image archive missing (${archive})`);
}
const loadPlan = fs.readFileSync(path.join(runtime, 'images/load-plan.tsv'), 'utf8').trim().split('\n');
if (loadPlan.length !== imageIndex.images.length) throw new Error('Packaging blocked: invalid image load plan length');
for (const [index, line] of loadPlan.entries()) {
  const [archive, image, extra] = line.split('\t');
  if (extra || archive !== imageIndex.images[index] || !manifest.services?.[image]) throw new Error(`Packaging blocked: invalid image load plan entry (${line})`);
}
console.log(`PACKAGING INPUT PASS: ${manifest.frontend.releaseId} / schema ${manifest.schema.expectedVersion}`);
