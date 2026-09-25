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
  return async function rest(pathname, options = {}) {
    const url = `${apiBase}${pathname}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(options.headers || {}),
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

async function resolveEventById(rest, eventId) {
  const matches = await rest(`/events?select=id,name&id=eq.${eventId}&limit=1`);
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error(`Event ${eventId} introuvable dans le Supabase local HP.`);
  }
  return matches[0];
}

async function resolveHeat(rest, eventId, podiumId) {
  const current = await rest(
    `/active_heat_pointer?select=event_id,active_heat_id,event_name,podium_id&event_id=eq.${eventId}&podium_id=eq.${podiumId}&limit=1`,
  ).catch(() => []);
  if (Array.isArray(current) && current[0]?.active_heat_id) {
    return {
      ...current[0],
      heat_id: current[0].active_heat_id,
    };
  }

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
  const parts = parsed.hostname.split('.').map(Number);
  const privateIp = parts.length === 4 && (parts[0] === 10 || parts[0] === 127
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  if (parsed.hostname === 'localhost' || parsed.hostname === 'priority.local' || privateIp) return 'local';
  if (parsed.host === `${hpHost}:8000` || parsed.host === `${hpHost}:8080`) return 'local';
  return 'public';
}

function operationalStateFingerprint(health) {
  const podiums = Array.isArray(health?.podiums) ? health.podiums : [];
  return JSON.stringify(
    podiums
      .map((podium) => ({
        podium_id: podium?.podium_id ?? null,
        active_heat_id: podium?.active_heat_id ?? null,
        heat_status: podium?.heat_status ?? null,
        realtime_status: podium?.realtime_status ?? null,
        panel_count: Number(podium?.panel_count ?? 0),
        heat_assignment_count: Number(podium?.heat_assignment_count ?? 0),
      }))
      .sort((left, right) => String(left.podium_id).localeCompare(String(right.podium_id))),
  );
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

  const publicRequests = requests.filter((entry) => classifyRequest(entry.url, hpHost) === 'public');
  const failingResponses = responses.filter((entry) => entry.status >= 400);
  const idleFetches = idleRequests.filter((entry) => entry.resourceType === 'fetch');
  const idleLocalFetches = idleFetches.filter((entry) => classifyRequest(entry.url, hpHost) === 'local');

  await page.close();

  return {
    name: pageSpec.name,
    url: pageSpec.url,
    ok: hasExpectedText &&
      publicRequests.length === 0 &&
      failingResponses.length === 0 &&
      failures.length === 0 &&
      idleLocalFetches.length <= maxIdleFetches,
    hasExpectedText,
    totalRequests: requests.length,
    idleFetches: idleFetches.length,
    idleLocalFetches: idleLocalFetches.length,
    publicRequests: publicRequests.map((entry) => entry.url).slice(0, 8),
    failingResponses: failingResponses.slice(0, 8),
    requestFailures: failures.slice(0, 8),
    textSample: text.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

async function launchBrowser() {
  const configuredChannel = process.env.SURF_PLAYWRIGHT_CHANNEL || undefined;
  if (configuredChannel) {
    return chromium.launch({ headless: true, channel: configuredChannel });
  }

  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/executable doesn't exist|playwright install/i.test(message)) {
      throw error;
    }
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

async function main() {
  const hpHost = readArg('host', resolveHpHost());
  const eventIdArg = readArg('event-id', process.env.SURF_HP_EVENT_ID || '');
  const eventName = readArg('event', process.env.SURF_HP_EVENT_NAME || 'SANDY CUP');
  const judgePosition = readArg('judge', process.env.SURF_HP_JUDGE_POSITION || 'J1');
  const idleMs = Number(readArg('idle-ms', process.env.SURF_HP_SMOKE_IDLE_MS || '12000'));
  const maxIdleFetches = Number(readArg('max-idle-fetches', process.env.SURF_HP_SMOKE_MAX_IDLE_FETCHES || '8'));
  const webBase = `http://${hpHost}:8080`;
  const apiBase = `http://${hpHost}:8000/rest/v1`;
  const key = (await readEnvValue('VITE_SUPABASE_ANON_KEY_LAN')) || DEFAULT_LOCAL_KEY;
  const rest = createRestClient(apiBase, key);

  const numericEventId = eventIdArg === '' ? null : Number(eventIdArg);
  if (numericEventId !== null && (!Number.isInteger(numericEventId) || numericEventId <= 0)) {
    throw new Error(`event-id invalide: ${eventIdArg}`);
  }

  const [expectedSchema, installedSchemaRows, event] = await Promise.all([
    latestMigrationVersion(),
    rest('/app_runtime_schema_version?select=schema_version,updated_at&limit=1'),
    numericEventId === null
      ? resolveEvent(rest, eventName)
      : resolveEventById(rest, numericEventId),
  ]);
  const installedSchema = Array.isArray(installedSchemaRows)
    ? installedSchemaRows[0]?.schema_version || ''
    : '';
  const operationsHealth = await rest('/rpc/fn_get_event_operations_health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_event_id: event.id }),
  });
  const healthPodiums = Array.isArray(operationsHealth?.podiums) ? operationsHealth.podiums : [];
  const podiumAHealth = healthPodiums.find((podium) => podium?.podium_id === 'A');
  const podiumBHealth = healthPodiums.find((podium) => podium?.podium_id === 'B');
  const [fallbackHeatA, fallbackHeatB] = await Promise.all([
    podiumAHealth?.active_heat_id ? null : resolveHeat(rest, event.id, 'A'),
    podiumBHealth?.active_heat_id ? null : resolveHeat(rest, event.id, 'B'),
  ]);
  const heatA = podiumAHealth?.active_heat_id
    ? { ...podiumAHealth, heat_id: podiumAHealth.active_heat_id }
    : fallbackHeatA;
  const heatB = podiumBHealth?.active_heat_id
    ? { ...podiumBHealth, heat_id: podiumBHealth.active_heat_id }
    : fallbackHeatB;

  const query = new URLSearchParams({ eventId: String(event.id) });

  const pageSpecs = [
    {
      name: 'admin',
      url: `${webBase}/admin?${query.toString()}`,
      expect: ['Administration', 'Diagnostic', event.name],
    },
    {
      name: 'display-A',
      url: `${webBase}/display?${new URLSearchParams({ eventId: String(event.id), podium: 'A' })}`,
      expect: [event.name, 'HEAT HISTORY'],
    },
    {
      name: 'display-B',
      url: `${webBase}/display?${new URLSearchParams({ eventId: String(event.id), podium: 'B' })}`,
      expect: [event.name, 'HEAT HISTORY'],
    },
    {
      name: 'judge-A',
      url: `${webBase}/judge?${new URLSearchParams({
        eventId: String(event.id),
        position: judgePosition,
        podium: 'A',
      })}`,
      expect: ['Interface Juge', 'Mode Kiosque', event.name],
    },
    {
      name: 'judge-B',
      url: `${webBase}/judge?${new URLSearchParams({
        eventId: String(event.id),
        position: judgePosition,
        podium: 'B',
      })}`,
      expect: ['Interface Juge', 'Mode Kiosque', event.name],
    },
    {
      name: 'priority',
      url: `${webBase}/priority?${query.toString()}`,
      expect: ['Priorité', event.name],
    },
  ];

  const browser = await launchBrowser();
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

  const operationsHealthAfter = await rest('/rpc/fn_get_event_operations_health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_event_id: event.id }),
  });
  const schemaOk = expectedSchema === installedSchema;
  const passiveStateOk =
    operationalStateFingerprint(operationsHealth) ===
    operationalStateFingerprint(operationsHealthAfter);
  const podiumIsolationOk = Boolean(
    heatA?.heat_id &&
    heatB?.heat_id &&
    heatA.heat_id !== heatB.heat_id &&
    podiumAHealth?.panel_count > 0 &&
    podiumBHealth?.panel_count > 0,
  );
  const ok = schemaOk && podiumIsolationOk && passiveStateOk && pages.every((page) => page.ok);
  const summary = {
    ok,
    hpHost,
    event,
    heats: { A: heatA, B: heatB },
    operationsHealthBefore: operationsHealth,
    operationsHealthAfter,
    podiumIsolationOk,
    passiveStateOk,
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
