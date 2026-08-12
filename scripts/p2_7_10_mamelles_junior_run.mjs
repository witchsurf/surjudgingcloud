#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = path.join(rootDir, 'artifacts', 'p2_7_10_mamelles_junior');
const baseUrl = process.env.P2_7_10_BASE_URL || 'http://192.168.1.41:8080';
const eventId = Number(process.env.P2_7_10_EVENT_ID || '10');
const podium = process.env.P2_7_10_PODIUM || 'A';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) {
    return chromium.launch({ headless: true, executablePath });
  }

  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/executable doesn't exist|playwright install/i.test(message)) throw error;
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

function contextSpec(name, route) {
  return { name, url: `${baseUrl}${route}` };
}

const contextSpecs = [
  contextSpec('admin', `/admin?eventId=${eventId}`),
  contextSpec('j1', `/judge?eventId=${eventId}&position=J1&podium=${podium}`),
  contextSpec('j2', `/judge?eventId=${eventId}&position=J2&podium=${podium}`),
  contextSpec('j3', `/judge?eventId=${eventId}&position=J3&podium=${podium}`),
  contextSpec('display', `/display?eventId=${eventId}&podium=${podium}`),
];

async function attachTelemetry(page, sink) {
  page.on('console', (msg) => {
    sink.console.push({
      type: msg.type(),
      text: msg.text(),
    });
  });
  page.on('request', (request) => {
    sink.requests.push({
      method: request.method(),
      url: request.url(),
    });
  });
  page.on('response', async (response) => {
    sink.responses.push({
      status: response.status(),
      url: response.url(),
    });
  });
  page.on('requestfailed', (request) => {
    sink.failures.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });
}

async function collectPageState(name, page) {
  const title = await page.title();
  const text = await page.locator('body').innerText().catch(() => '');
  const localStorageDump = await page.evaluate(() => ({ ...localStorage }));
  const sessionStorageDump = await page.evaluate(() => ({ ...sessionStorage }));
  const indexedDbDump = await page.evaluate(async () => {
    if (!('indexedDB' in window)) return { available: false };
    const dbs = await indexedDB.databases?.();
    return {
      available: true,
      databases: dbs || [],
    };
  }).catch((error) => ({ available: true, error: String(error) }));

  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true });

  return {
    url: page.url(),
    title,
    textSample: text.replace(/\s+/g, ' ').trim().slice(0, 4000),
    localStorage: localStorageDump,
    sessionStorage: sessionStorageDump,
    indexedDb: indexedDbDump,
  };
}

async function expectText(page, value, timeout = 15000) {
  await page.getByText(value, { exact: false }).first().waitFor({ timeout });
}

async function loginKioskJudge(page, assignedName) {
  await page.getByRole('button', { name: new RegExp(`Continuer comme ${assignedName}`, 'i') }).click();
  await expectText(page, assignedName);
  await expectText(page, 'Interface Juge');
}

async function clickWaveCell(page, surfer, wave) {
  const surferCard = page.locator('.judge-surfer-card').filter({ hasText: surfer }).first();
  await surferCard.waitFor({ timeout: 15000 });
  await surferCard.locator('.judge-wave-cell').nth(wave - 1).click();
}

async function enterScore(page, digits) {
  for (const key of digits) {
    await page.getByRole('button', { name: key, exact: true }).click();
  }
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

async function main() {
  await ensureDir(artifactsDir);
  const browser = await launchBrowser();
  const results = {};

  try {
    const live = {};
    for (const spec of contextSpecs) {
      const telemetry = { console: [], requests: [], responses: [], failures: [] };
      const context = await browser.newContext({
        viewport: { width: spec.name === 'display' ? 1440 : 1280, height: 900 },
      });
      const page = await context.newPage();
      await attachTelemetry(page, telemetry);
      await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      results[spec.name] = {
        ...(await collectPageState(spec.name, page)),
        telemetry,
      };
      live[spec.name] = { context, page, telemetry };
    }

    await loginKioskJudge(live.j1.page, 'CHARLES');
    await loginKioskJudge(live.j2.page, 'J1MAIMOUNA');
    await loginKioskJudge(live.j3.page, 'JKHADIJA');

    const startButton = live.admin.page.getByRole('button', { name: /^START$/i });
    const pauseButton = live.admin.page.getByRole('button', { name: /^PAUSE$/i });
    if (await startButton.count()) {
      await startButton.click();
      await live.admin.page.waitForTimeout(3000);
      await live.display.page.waitForTimeout(3000);
      await live.j1.page.waitForTimeout(3000);
    } else if (await pauseButton.count()) {
      await live.admin.page.waitForTimeout(2000);
      await live.display.page.waitForTimeout(2000);
      await live.j1.page.waitForTimeout(2000);
    } else {
      throw new Error('Ni START ni PAUSE visible sur Admin; état heat non déterminé.');
    }

    results.afterStart = {
      admin: await collectPageState('admin_after_start', live.admin.page),
      j1: await collectPageState('j1_after_start', live.j1.page),
      j2: await collectPageState('j2_after_start', live.j2.page),
      j3: await collectPageState('j3_after_start', live.j3.page),
      display: await collectPageState('display_after_start', live.display.page),
    };

    await clickWaveCell(live.j1.page, 'ROUGE', 1);
    await enterScore(live.j1.page, ['7', '.', '0']);
    await live.j1.page.waitForTimeout(4000);
    await live.admin.page.waitForTimeout(4000);
    await live.display.page.waitForTimeout(4000);

    results.afterFirstScore = {
      j1: await collectPageState('j1_after_first_score', live.j1.page),
      admin: await collectPageState('admin_after_first_score', live.admin.page),
      display: await collectPageState('display_after_first_score', live.display.page),
    };

    for (const key of Object.keys(live)) {
      await live[key].context.close();
    }
  } finally {
    await browser.close();
  }

  const outFile = path.join(artifactsDir, 'probe.json');
  await fs.writeFile(outFile, JSON.stringify(results, null, 2));
  process.stdout.write(`${outFile}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
