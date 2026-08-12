#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = path.join(rootDir, 'artifacts', 'p2_7_11_admin_canonical');
const baseUrl = process.env.P2_7_11_BASE_URL || 'http://192.168.1.41:8080';
const eventId = Number(process.env.P2_7_11_EVENT_ID || '10');
const podium = process.env.P2_7_11_PODIUM || 'A';
const allowJ2Score = process.env.P2_7_11_ALLOW_J2_SCORE === '1';
const allowJudgeScore = process.env.P2_7_11_ALLOW_JUDGE_SCORE === '1';
const scoreJudge = (process.env.P2_7_11_SCORE_JUDGE || '').toLowerCase();
const scoreJudgeName = process.env.P2_7_11_SCORE_JUDGE_NAME || '';
const scoreSurfer = process.env.P2_7_11_SCORE_SURFER || 'ROUGE';
const scoreWave = Number(process.env.P2_7_11_SCORE_WAVE || '1');
const scoreDigits = (process.env.P2_7_11_SCORE_DIGITS || '').trim();

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

function contextSpec(name, route, viewport = { width: 1280, height: 900 }) {
  return { name, url: `${baseUrl}${route}`, viewport };
}

const contextSpecs = [
  contextSpec('admin', `/admin?eventId=${eventId}`),
  contextSpec('j1', `/judge?eventId=${eventId}&position=J1&podium=${podium}`),
  contextSpec('j2', `/judge?eventId=${eventId}&position=J2&podium=${podium}`),
  contextSpec('j3', `/judge?eventId=${eventId}&position=J3&podium=${podium}`),
  contextSpec('display', `/display?eventId=${eventId}&podium=${podium}`, { width: 1440, height: 900 }),
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
      resourceType: request.resourceType(),
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
    return { available: true, databases: dbs || [] };
  }).catch((error) => ({ available: true, error: String(error) }));
  const accessibility = await (async () => {
    if (page.accessibility?.snapshot) {
      return page.accessibility.snapshot().catch((error) => ({
        error: String(error),
      }));
    }

    return page.locator('body').ariaSnapshot().catch((error) => ({
      error: String(error),
    }));
  })();

  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true });

  return {
    url: page.url(),
    title,
    textSample: text.replace(/\s+/g, ' ').trim().slice(0, 6000),
    localStorage: localStorageDump,
    sessionStorage: sessionStorageDump,
    indexedDb: indexedDbDump,
    accessibility,
  };
}

async function expectText(page, value, timeout = 15000) {
  await page.getByText(value, { exact: false }).first().waitFor({ timeout });
}

async function loginKioskJudge(page, assignedName) {
  const button = page.getByRole('button', { name: new RegExp(`Continuer comme ${assignedName}`, 'i') });
  if (await button.count()) {
    await button.click();
  }
  await expectText(page, assignedName);
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

function summarizeHeatRequests(telemetry) {
  const interesting = [];
  const patterns = ['/scores?', '/heat_entries?', '/v_heat_lineup?', '/heats?', '/heat_slot_mappings?', '/heat_configs?', '/heat_realtime_config?'];
  for (const request of telemetry.requests) {
    if (patterns.some((pattern) => request.url.includes(pattern))) {
      interesting.push(request);
    }
  }
  return interesting;
}

function adminLooksCanonical(text, requests = []) {
  const normalized = text.replace(/\s+/g, ' ');
  const hasCurrentHeatShortId = requests.some((request) =>
    /(?:heat_id|id)=eq\.r1_h1(?:[&]|$)/i.test(request.url)
  );
  const hasCanonicalScoreRead = requests.some((request) =>
    request.url.includes('/scores?') && request.url.includes('heat_id=eq.mamelles_open_junior_r1_h1')
  );

  return (
    normalized.includes('ROUGE Babacar Sene V1:7.00*')
    && hasCanonicalScoreRead
    && !hasCurrentHeatShortId
  );
}

async function main() {
  await ensureDir(artifactsDir);
  const browser = await launchBrowser();
  const results = {
    meta: {
      baseUrl,
      eventId,
      podium,
      allowJ2Score,
      allowJudgeScore,
      scoreJudge,
      scoreJudgeName,
      scoreSurfer,
      scoreWave,
      scoreDigits,
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH || null,
    },
  };

  try {
    const live = {};
    for (const spec of contextSpecs) {
      const telemetry = { console: [], requests: [], responses: [], failures: [] };
      const context = await browser.newContext({ viewport: spec.viewport });
      const page = await context.newPage();
      await attachTelemetry(page, telemetry);
      await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      live[spec.name] = { context, page, telemetry };
      results[spec.name] = await collectPageState(spec.name, page);
    }

    await loginKioskJudge(live.j1.page, 'CHARLES');
    await loginKioskJudge(live.j2.page, 'J1MAIMOUNA');
    await loginKioskJudge(live.j3.page, 'JKHADIJA');

    await live.admin.page.waitForTimeout(5000);
    await live.display.page.waitForTimeout(3000);

    results.afterLogin = {
      admin: await collectPageState('admin_after_login', live.admin.page),
      j1: await collectPageState('j1_after_login', live.j1.page),
      j2: await collectPageState('j2_after_login', live.j2.page),
      j3: await collectPageState('j3_after_login', live.j3.page),
      display: await collectPageState('display_after_login', live.display.page),
      adminRequests: summarizeHeatRequests(live.admin.telemetry),
      adminConsole: live.admin.telemetry.console,
      adminFailures: live.admin.telemetry.failures,
    };

    const canonicalOk = adminLooksCanonical(
      results.afterLogin.admin.textSample,
      results.afterLogin.adminRequests,
    );
    results.canonicalCheck = {
      passed: canonicalOk,
      textSample: results.afterLogin.admin.textSample,
    };

    if (allowJ2Score) {
      await clickWaveCell(live.j2.page, 'ROUGE', 1);
      await enterScore(live.j2.page, ['7', '.', '5']);
      await live.j2.page.waitForTimeout(4000);
      await live.admin.page.waitForTimeout(6000);
      await live.display.page.waitForTimeout(6000);

      results.afterJ2Score = {
        admin: await collectPageState('admin_after_j2_score', live.admin.page),
        j2: await collectPageState('j2_after_j2_score', live.j2.page),
        display: await collectPageState('display_after_j2_score', live.display.page),
        adminRequests: summarizeHeatRequests(live.admin.telemetry),
        adminConsole: live.admin.telemetry.console,
        adminFailures: live.admin.telemetry.failures,
      };
    }

    if (allowJudgeScore && live[scoreJudge] && scoreJudgeName && scoreDigits) {
      const judgePage = live[scoreJudge].page;
      await loginKioskJudge(judgePage, scoreJudgeName);
      await clickWaveCell(judgePage, scoreSurfer, scoreWave);
      await enterScore(judgePage, scoreDigits.split(''));
      await judgePage.waitForTimeout(4000);
      await live.admin.page.waitForTimeout(6000);
      await live.display.page.waitForTimeout(6000);

      results.afterJudgeScore = {
        admin: await collectPageState('admin_after_judge_score', live.admin.page),
        judge: await collectPageState(`${scoreJudge}_after_judge_score`, judgePage),
        display: await collectPageState('display_after_judge_score', live.display.page),
        adminRequests: summarizeHeatRequests(live.admin.telemetry),
        adminConsole: live.admin.telemetry.console,
        adminFailures: live.admin.telemetry.failures,
        scoreAction: {
          judge: scoreJudge,
          judgeName: scoreJudgeName,
          surfer: scoreSurfer,
          wave: scoreWave,
          digits: scoreDigits,
        },
      };
    }

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
