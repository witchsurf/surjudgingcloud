#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
  'images/index.json',
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
console.log(`PACKAGING INPUT PASS: ${manifest.frontend.releaseId} / schema ${manifest.schema.expectedVersion}`);
