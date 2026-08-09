#!/usr/bin/env node

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(rootDir, 'frontend');
const distDir = process.env.P1_DIST_DIR
  ? path.resolve(process.env.P1_DIST_DIR)
  : path.join(frontendDir, 'dist');
const host = '127.0.0.1';
const port = Number(process.env.P1_AUDIT_PORT || 4173);
const frontendOrigin = `http://${host}:${port}`;
const configuredSupabaseUrl = process.env.P1_LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
const routes = ['/admin', '/chief-judge', '/judge', '/priority', '/display'];

const forbiddenHostFragments = [
  'supabase.co',
  'supabase.net',
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'stripe.com',
  'unsplash.com',
];

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 127;
};

function isAllowed(urlString) {
  if (/^(?:data|blob|about):/i.test(urlString)) return true;
  try {
    const url = new URL(urlString, frontendOrigin);
    if (url.origin === frontendOrigin) return true;
    if (url.hostname === 'localhost' || url.hostname === 'priority.local') return true;
    if (isPrivateIpv4(url.hostname)) return true;
    const supabase = new URL(configuredSupabaseUrl);
    if (url.origin === supabase.origin && (supabase.hostname === 'localhost' || isPrivateIpv4(supabase.hostname))) return true;
    return false;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

async function staticAssetAudit() {
  const files = await walk(distDir);
  const inspected = files.filter((file) => /\.(?:html|css|svg|json)$/i.test(file));
  const violations = [];
  for (const file of inspected) {
    const content = await fs.readFile(file, 'utf8');
    const urls = content.match(/https?:\/\/[^\s"'<>)}]+/gi) || [];
    for (const url of urls) {
      if (url === 'http://www.w3.org/2000/svg') continue; // XML namespace identifier; never fetched.
      if (!isAllowed(url)) violations.push({ file: path.relative(rootDir, file), url });
    }
  }
  // JavaScript may legitimately contain dormant cloud-only modules (payments,
  // pre-event sync). Runtime interception below decides whether field routes
  // actually call them. Static asset sources themselves must remain local.
  const allTextAssets = inspected;
  const forbiddenMarkers = [];
  for (const file of allTextAssets) {
    const content = await fs.readFile(file, 'utf8');
    for (const marker of forbiddenHostFragments) {
      if (content.toLowerCase().includes(marker)) {
        forbiddenMarkers.push({ file: path.relative(rootDir, file), marker });
      }
    }
  }
  return { inspectedFiles: inspected.length, violations, forbiddenMarkers };
}

async function waitForServer(child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Vite preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(frontendOrigin);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite preview unavailable at ${frontendOrigin}`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/executable doesn't exist|playwright install/i.test(message)) throw error;
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

async function runtimeAudit() {
  const preview = spawn('npm', ['run', 'preview', '--', '--host', host, '--port', String(port), '--strictPort'], {
    cwd: frontendDir,
    env: { ...process.env, P1_DIST_DIR: distDir, VITE_DEPLOYMENT_MODE: 'field' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(preview);
    const browser = await launchBrowser();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => {
      sessionStorage.setItem('admin_offline_auth', 'true');
      localStorage.setItem('surfjudging_offline_user', JSON.stringify({
        id: 'p1-field-audit',
        email: 'operator@local.network',
        subscription: { plan: 'pro', validUntil: '2099-01-01T00:00:00.000Z', isPaid: true },
      }));
    });
    const violations = [];
    const checkedRoutes = [];
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (!isAllowed(url)) {
        violations.push({ route: route.request().frame()?.url() || '', url, resourceType: route.request().resourceType() });
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    for (const routePath of routes) {
      const page = await context.newPage();
      const response = await page.goto(`${frontendOrigin}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1800);
      checkedRoutes.push({ route: routePath, httpStatus: response?.status() ?? null, finalPath: new URL(page.url()).pathname });
      await page.close();
    }
    await browser.close();
    return { checkedRoutes, violations };
  } finally {
    preview.kill('SIGTERM');
  }
}

async function main() {
  await fs.access(path.join(distDir, 'index.html'));
  const staticAudit = await staticAssetAudit();
  const runtime = await runtimeAudit();
  const ok = staticAudit.violations.length === 0
    && staticAudit.forbiddenMarkers.length === 0
    && runtime.violations.length === 0
    && runtime.checkedRoutes.every((route) => route.httpStatus === 200);
  const report = {
    ok,
    policy: {
      frontendOrigin,
      configuredSupabaseUrl,
      allowed: ['frontend origin', 'localhost/127.0.0.1', 'RFC1918 private IPs', 'priority.local', 'configured local Supabase origin'],
      denied: ['Supabase Cloud', 'Google/Google Sheets', 'Stripe', 'Unsplash', 'all other public domains'],
    },
    staticAudit,
    runtime,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
