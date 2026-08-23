#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(rootDir, 'frontend');
const distFieldDir = path.resolve(frontendDir, 'dist-field');

/**
 * Parse .env file without modifying process.env or executing shell
 */
export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Runtime .env file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx === -1) continue;

    const key = trimmed.slice(0, equalsIdx).trim();
    let value = trimmed.slice(equalsIdx + 1).trim();

    // Strip wrapping quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Compute SHA-256 fingerprint (hex)
 */
export function computeSha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * Get current git commit hash if available
 */
export function getGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Preflight check: verify ANON_KEY against PostgreSQL / PostgREST
 */
export async function runPreflightCheck(supabaseUrl, anonKey) {
  if (!supabaseUrl) {
    throw new Error('Preflight check failed: Supabase URL is missing');
  }
  if (!anonKey) {
    throw new Error('Preflight check failed: Anon key is missing');
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/events?select=id&limit=1`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Preflight rejected by Supabase (${endpoint}): HTTP ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    return { ok: true, status: response.status };
  } catch (err) {
    throw new Error(`Preflight check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Post-build verification: scan dist-field bundle for anon key matching runtime fingerprint
 */
export function verifyBundleFingerprint(distDir, expectedAnonKey, expectedUrl) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output directory missing: ${distDir}`);
  }

  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Assets directory missing in build output: ${assetsDir}`);
  }

  const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    throw new Error(`No JavaScript chunks found in ${assetsDir}`);
  }

  const expectedFingerprint = computeSha256(expectedAnonKey);
  let foundMatchingKey = false;
  let detectedKeyFingerprint = null;

  for (const jsFile of jsFiles) {
    const filePath = path.join(assetsDir, jsFile);
    const content = fs.readFileSync(filePath, 'utf8');

    if (content.includes(expectedAnonKey)) {
      foundMatchingKey = true;
      detectedKeyFingerprint = expectedFingerprint;
      break;
    }
  }

  if (!foundMatchingKey) {
    throw new Error(
      `Bundle fingerprint mismatch! Expected anon key (SHA256: ${expectedFingerprint.slice(0, 12)}) was NOT embedded in the JS bundle.`
    );
  }

  return {
    matched: true,
    fingerprint: expectedFingerprint,
    shortFingerprint: expectedFingerprint.slice(0, 12),
  };
}

/**
 * Main build orchestration
 */
export async function buildFieldRuntime(runtimeName, options = {}) {
  if (!runtimeName) {
    const runtimesDir = path.resolve(rootDir, 'artifacts/runtimes');
    const available = fs.existsSync(runtimesDir)
      ? fs.readdirSync(runtimesDir).filter((f) => fs.statSync(path.join(runtimesDir, f)).isDirectory())
      : [];

    console.error('❌ Error: Runtime name must be specified.');
    console.error(`Available runtimes:\n${available.map((r) => `  - ${r}`).join('\n') || '  (none found)'}`);
    console.error('\nUsage: npm run field:build -- <runtime-name>');
    process.exit(1);
  }

  const runtimeDir = path.resolve(rootDir, 'artifacts/runtimes', runtimeName);
  const runtimeEnvPath = path.resolve(runtimeDir, '.env');

  console.log(`==> [FIELD BUILD] Selected runtime: ${runtimeName}`);
  console.log(`==> [FIELD BUILD] Reading source of truth: ${runtimeEnvPath}`);

  const runtimeEnv = parseEnvFile(runtimeEnvPath);

  const anonKey = runtimeEnv.ANON_KEY || runtimeEnv.VITE_SUPABASE_ANON_KEY;
  const supabaseUrl =
    runtimeEnv.API_EXTERNAL_URL ||
    runtimeEnv.SUPABASE_URL ||
    runtimeEnv.VITE_SUPABASE_URL ||
    'http://localhost:18400';
  const siteUrl = runtimeEnv.SITE_URL || runtimeEnv.VITE_SITE_URL || 'http://localhost:18480';

  if (!anonKey) {
    throw new Error(`ANON_KEY is missing in runtime .env: ${runtimeEnvPath}`);
  }
  if (!supabaseUrl) {
    throw new Error(`SUPABASE_URL / API_EXTERNAL_URL is missing in runtime .env: ${runtimeEnvPath}`);
  }

  const runtimeFingerprint = computeSha256(anonKey);
  console.log(`==> [FIELD BUILD] Runtime ANON_KEY SHA256: ${runtimeFingerprint.slice(0, 12)}...`);
  console.log(`==> [FIELD BUILD] Target Supabase URL: ${supabaseUrl}`);

  // Step 1: Preflight check against live Supabase endpoint (unless explicitly skipped in mock tests)
  if (!options.skipPreflight) {
    console.log(`==> [PREFLIGHT] Checking PostgreSQL/PostgREST authentication...`);
    const preflight = await runPreflightCheck(supabaseUrl, anonKey);
    console.log(`✅ [PREFLIGHT PASS] Supabase accepted ANON_KEY (HTTP ${preflight.status})`);
  } else {
    console.log(`⚠️ [PREFLIGHT] Skipped (test mode)`);
  }

  // Step 2: Configure build environment to strictly override any host or .env variables
  const buildEnv = {
    ...process.env,
    VITE_DEPLOYMENT_MODE: 'field',
    SURF_RUNTIME_NAME: runtimeName,
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_URL_LOCAL: supabaseUrl,
    VITE_SUPABASE_URL_LAN: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_SUPABASE_ANON_KEY_LOCAL: anonKey,
    VITE_SUPABASE_ANON_KEY_LAN: anonKey,
    VITE_SITE_URL: siteUrl,
    VITE_SITE_URL_LAN: siteUrl,
    VITE_DEV_MODE: 'false',
    VITE_CLOUD_LOCK: 'false',
    // Clean out cloud keys to prevent accidental leaks
    VITE_SUPABASE_URL_CLOUD: '',
    VITE_SUPABASE_ANON_KEY_CLOUD: '',
    SUPABASE_SERVICE_ROLE_KEY_CLOUD: '',
  };

  // Step 3: Run Vite build
  console.log(`==> [BUILD] Invoking Vite build for Field mode...`);
  const viteBin = path.resolve(frontendDir, 'node_modules/vite/bin/vite.js');
  const buildResult = spawnSync(process.execPath, [viteBin, 'build', '--outDir', 'dist-field'], {
    cwd: frontendDir,
    stdio: 'inherit',
    env: buildEnv,
  });

  if (buildResult.status !== 0) {
    throw new Error(`Vite build failed with exit code ${buildResult.status}`);
  }

  // Step 4: Post-build bundle fingerprint verification
  console.log(`==> [POST-BUILD] Verifying bundle anon key fingerprint...`);
  const verification = verifyBundleFingerprint(distFieldDir, anonKey, supabaseUrl);
  console.log(`✅ [FINGERPRINT MATCH] Bundle embedded key matches runtime: ${verification.shortFingerprint}`);

  // Step 5: Write deployment manifest (without plain secrets)
  let parsedHost = 'localhost';
  try {
    parsedHost = new URL(supabaseUrl).host;
  } catch {
    parsedHost = supabaseUrl;
  }

  const manifest = {
    mode: 'field',
    runtime: runtimeName,
    supabaseHost: parsedHost,
    anonKeyFingerprint: verification.shortFingerprint,
    buildTimestamp: new Date().toISOString(),
    gitCommit: getGitCommit(),
  };

  const manifestPath = path.join(distFieldDir, 'deployment-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✅ [MANIFEST] Written to ${manifestPath}`);

  return {
    success: true,
    runtime: runtimeName,
    fingerprint: verification.fingerprint,
    shortFingerprint: verification.shortFingerprint,
    manifest,
  };
}

// Direct execution from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const runtimeArg = process.argv[2] || process.env.SURF_RUNTIME_NAME;
  buildFieldRuntime(runtimeArg)
    .then(() => {
      console.log('\n🎉 [FIELD BUILD COMPLETE] Field bundle ready in dist-field/');
    })
    .catch((err) => {
      console.error(`\n❌ [FIELD BUILD ABORTED] ${err.message}`);
      // Remove corrupted dist-field if verification failed
      if (fs.existsSync(distFieldDir) && err.message.includes('Bundle fingerprint mismatch')) {
        console.warn('⚠️ Purging invalid dist-field directory to prevent stale deployment');
        fs.rmSync(distFieldDir, { recursive: true, force: true });
      }
      process.exit(1);
    });
}
