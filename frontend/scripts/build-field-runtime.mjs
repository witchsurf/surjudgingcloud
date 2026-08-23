#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootScript = path.resolve(__dirname, '../../scripts/build-field-runtime.mjs');

// Execute the root CLI in a child process. Importing it would skip its CLI guard.
const result = spawnSync(process.execPath, [rootScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
