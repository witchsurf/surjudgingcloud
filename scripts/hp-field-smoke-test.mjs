#!/usr/bin/env node

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_LOCAL_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODY3NjA0MDV9.R7dF61lzIX8Zj2AQxZVQ2cltHnjQX0t-I1QckuSNLyA';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length);
}

function resolveHpHost() {
  if (process.env.SURF_HP_HOST) return process.env.SURF_HP_HOST;
  const profile = (process.env.SURF_HP_PROFILE || '').toLowerCase();
  if (profile === 'home') return '10.0.0.14';
  return '192.168.1.2';
}

async function readEnvValue(name) {
  if (process.env[name]) return process.env[name];

  const envFiles = [
    path.join(rootDir, 'frontend/.env.local'),
    path.join(rootDir, 'frontend/.env.production'),
    path.join(rootDir, 'frontend/.env'),
  ];

  for (const file of envFiles) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const line = raw
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith(`${name}=`));
      if (!line) continue;
      return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    } catch {
      // Try the next env file.
    }
  }

  return '';
}

async function latestMigrationVersion() {
  const migrationDir = path.join(rootDir, 'backend/supabase/migrations');
  const entries = await fs.readdir(migrationDir);
  const migrations = entries
    .filter((entry) => entry.endsWith('.sql'))
    .filter((entry) => !entry.startsWith('._'))
    .filter((entry) => entry !== 'TEST_MIGRATIONS.sql')
    .sort();
  const latest = migrations.at(-1) || '';
  return latest.replace(/\.sql$/, '');
}

function createRestClient(apiBase, key) {
  return async function rest(pathname) {
    const url = `${apiBase}${pathname}`;
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} on ${url}: ${body.slice(0, 200)}`);
    }
    return body ? JSON.parse(body) : null;
  };
}

async function resolveEvent(rest, eventName) {
  const encodedName = encodeURIComponent(eventName);
  const matches = await rest(`/events?select=id,name&name=ilike.${encodedName}&order=id.desc&limit=1`);
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error(`Event "${eventName}" introuvable dans le Supabase local HP.`);
  }
  return matches[0];
}

async function resolveHeat(rest, eventId) {
  const current = await rest(
    `/active_heat_pointer?select=event_id,heat_id,event_name,competition,division,round,heat&event_id=eq.${eventId}&limit=1`,
  ).catch(() => []);
  if (Array.isArray(current) && current[0]?.heat_id) return current[0];

  const heats = await rest(
    `/heats?select=id,event_id,division,round,heat_number,status&event_id=eq.${eventId}&order=id.desc&limit=1`,
  );
  if (Array.isArray(heats) && heats[0]?.id) {
    return {
      event_id: eventId,
      heat_id: heats[0].id,
      division: heats[0].division,
      round: heats[0].round,
      heat: heats[0].heat_number,
    };
  }
  return null;
}

function classifyRequest(url, hpHost) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }
  if (parsed.host === `${hpHost}:8000` || parsed.host === `${hpHost}:8080`) return 'local';
  if (parsed.host.endsWith('supabase.co') || parsed.host === 'surfjudging.cloud') return 'cloud';
  return 'other';
}

async function inspectPage(context, pageSpec, hpHost, idleMs, maxIdleFetches) {
  const page = await context.newPage();
  const requests = [];
  const responses = [];
  const failures = [];
  const idleRequests = [];
  let idleMode = false;

  page.on('request', (request) => {
    const entry = {
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    };
    requests.push(entry);
    if (idleMode) idleRequests.push(entry);
  });
  page.on('response', (response) => {
    responses.push({
      status: response.status(),
      url: response.url(),
    });
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown';
    if (errorText === 'net::ERR_ABORTED') {
      return;
    }
    failures.push({
      url: request.url(),
      error: errorText,
    });
  });

  await page.goto(pageSpec.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3500);

  const text = await page.evaluate(() => document.body.innerText.slice(0, 700));
  const expectedTexts = pageSpec.expect || [];
  const hasExpectedText =
    expectedTexts.length === 0 ||
    expectedTexts.some((needle) => text.toLowerCase().includes(needle.toLowerCase()));

  idleMode = true;
  await page.waitForTimeout(idleMs);
  idleMode = false;

  const allCloudRequests = requests.filter((entry) => classifyRequest(entry.url, hpHost) === 'cloud');
  const failingResponses = responses.filter((entry) => entry.status >= 400);
  const idleFetches = idleRequests.filter((entry) => entry.resourceType === 'fetch');
  const idleLocalFetches = idleFetches.filter((entry) => classifyRequest(entry.url, hpHost) === 'local');

  await page.close();

  return {
    name: pageSpec.name,
    url: pageSpec.url,
    ok: hasExpectedText &&
      allCloudRequests.length === 0 &&
      failingResponses.length === 0 &&
      failures.length === 0 &&
      idleLocalFetches.length <= maxIdleFetches,
    hasExpectedText,
    totalRequests: requests.length,
    idleFetches: idleFetches.length,
    idleLocalFetches: idleLocalFetches.length,
    cloudRequests: allCloudRequests.map((entry) => entry.url).slice(0, 8),
    failingResponses: failingResponses.slice(0, 8),
    requestFailures: failures.slice(0, 8),
    textSample: text.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

async function main() {
  const hpHost = readArg('host', resolveHpHost());
  const eventName = readArg('event', process.env.SURF_HP_EVENT_NAME || 'SANDY CUP');
  const judgePosition = readArg('judge', process.env.SURF_HP_JUDGE_POSITION || 'J1');
  const idleMs = Number(readArg('idle-ms', process.env.SURF_HP_SMOKE_IDLE_MS || '12000'));
  const maxIdleFetches = Number(readArg('max-idle-fetches', process.env.SURF_HP_SMOKE_MAX_IDLE_FETCHES || '8'));
  const webBase = `http://${hpHost}:8080`;
  const apiBase = `http://${hpHost}:8000/rest/v1`;
  const key = (await readEnvValue('VITE_SUPABASE_ANON_KEY_LAN')) || DEFAULT_LOCAL_KEY;
  const rest = createRestClient(apiBase, key);

  const [expectedSchema, installedSchemaRows, event] = await Promise.all([
    latestMigrationVersion(),
    rest('/app_runtime_schema_version?select=schema_version,updated_at&limit=1'),
    resolveEvent(rest, eventName),
  ]);
  const installedSchema = Array.isArray(installedSchemaRows)
    ? installedSchemaRows[0]?.schema_version || ''
    : '';
  const heat = await resolveHeat(rest, event.id);

  const query = new URLSearchParams({ eventId: String(event.id) });
  const judgeQuery = new URLSearchParams({
    eventId: String(event.id),
    position: judgePosition,
  });

  const pageSpecs = [
    {
      name: 'admin',
      url: `${webBase}/admin?${query.toString()}`,
      expect: ['Administration', 'Diagnostic', event.name],
    },
    {
      name: 'display',
      url: `${webBase}/display?${query.toString()}`,
      expect: [event.name],
    },
    {
      name: 'judge',
      url: `${webBase}/judge?${judgeQuery.toString()}`,
      expect: ['Interface Juge', 'Mode Kiosque', event.name],
    },
  ];

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.SURF_PLAYWRIGHT_CHANNEL || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });

  await context.addInitScript(() => {
    try {
      window.sessionStorage.setItem('admin_offline_auth', 'true');
      window.localStorage.setItem(
        'surfjudging_offline_user',
        JSON.stringify({
          id: 'offline-admin',
          email: 'admin@local.network',
          subscription: {
            plan: 'pro',
            validUntil: '2099-12-31T00:00:00.000Z',
            isPaid: true,
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOnlineSync: null,
        }),
      );
    } catch {
      // Ignore storage errors in restricted browser contexts.
    }
  });

  const pages = [];
  for (const pageSpec of pageSpecs) {
    pages.push(await inspectPage(context, pageSpec, hpHost, idleMs, maxIdleFetches));
  }
  await browser.close();

  const schemaOk = expectedSchema === installedSchema;
  const ok = schemaOk && pages.every((page) => page.ok);
  const summary = {
    ok,
    hpHost,
    event,
    heat,
    expectedSchema,
    installedSchema,
    schemaOk,
    idleWindowMs: idleMs,
    maxIdleFetches,
    pages,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
