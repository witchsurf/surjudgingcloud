#!/usr/bin/env node
/**
 * generate-runtime-config.mjs
 *
 * Generates frontend/public/runtime-config.js at build time.
 * The file is listed in .gitignore and must NOT be committed.
 *
 * Values are read from environment variables (set by the CI/build script or
 * by the desktop packager before calling npm run build).
 *
 * Required env vars:
 *   VITE_SUPABASE_ANON_KEY   — Supabase anon JWT for the target environment
 *
 * Optional:
 *   SURFJUDGING_RUNTIME_CONFIG_PATH — override output path (defaults to
 *                                     frontend/public/runtime-config.js)
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!anonKey) {
  // Non-fatal: field runtime can operate without a key if the HP provides
  // its own key via nginx config injection.
  console.warn('[generate-runtime-config] Warning: VITE_SUPABASE_ANON_KEY is not set — runtime-config.js will have an empty anonKey.');
}

const outputPath = process.env.SURFJUDGING_RUNTIME_CONFIG_PATH
  ?? resolve(__dirname, '../frontend/public/runtime-config.js');

const content = `// AUTO-GENERATED — do not edit manually. Regenerate with: node scripts/generate-runtime-config.mjs
// This file is excluded from Git (.gitignore).
window.__SURFJUDGING_RUNTIME_CONFIG__ = Object.freeze({
  anonKey: ${JSON.stringify(anonKey)}
});
`;

writeFileSync(outputPath, content, 'utf8');
console.log(`[generate-runtime-config] Written to ${outputPath}`);
