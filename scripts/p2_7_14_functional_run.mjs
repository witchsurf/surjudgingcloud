#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = path.join(rootDir, 'artifacts', 'p2_7_14_functional');
const baseUrl = process.env.P2_7_14_BASE_URL || 'http://192.168.1.41:8080';
const eventId = Number(process.env.P2_7_14_EVENT_ID || '10');
const podium = process.env.P2_7_14_PODIUM || 'A';

const scorePlan = [
  ['j1', 'ROUGE', 2, '6.0'],
  ['j2', 'ROUGE', 2, '6.5'],
  ['j3', 'ROUGE', 2, '7.0'],
  ['j1', 'BLANC', 1, '6.0'],
  ['j2', 'BLANC', 1, '6.5'],
  ['j3', 'BLANC', 1, '7.0'],
  ['j1', 'BLANC', 2, '5.5'],
  ['j2', 'BLANC', 2, '6.0'],
  ['j3', 'BLANC', 2, '6.5'],
  ['j1', 'JAUNE', 1, '5.0'],
  ['j2', 'JAUNE', 1, '5.5'],
  ['j3', 'JAUNE', 1, '6.0'],
  ['j1', 'JAUNE', 2, '4.5'],
  ['j2', 'JAUNE', 2, '5.0'],
  ['j3', 'JAUNE', 2, '5.5'],
  ['j1', 'ROUGE', 3, '4.0'],
];

const judgeNames = {
  j1: 'CHARLES',
  j2: 'J1MAIMOUNA',
  j3: 'JKHADIJA',
};

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) return chromium.launch({ headless: true, executablePath });
  return chromium.launch({ headless: true });
}

async function attachTelemetry(page, sink) {
  page.on('console', (msg) => sink.console.push({ type: msg.type(), text: msg.text() }));
  page.on('request', (request) => sink.requests.push({ method: request.method(), url: request.url() }));
  page.on('response', (response) => sink.responses.push({ status: response.status(), url: response.url() }));
  page.on('requestfailed', (request) => sink.failures.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText || 'unknown' }));
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true });
  const text = await page.locator('body').innerText().catch(() => '');
  const localStorageDump = await page.evaluate(() => ({ ...localStorage }));
  const indexedDbDump = await page.evaluate(async () => ({
    available: 'indexedDB' in window,
    databases: await indexedDB.databases?.() || [],
  })).catch((error) => ({ error: String(error) }));
  return {
    url: page.url(),
    title: await page.title(),
    textSample: text.slice(0, 12000),
    localStorage: localStorageDump,
    indexedDb: indexedDbDump,
  };
}

async function loginJudge(page, assignedName) {
  const button = page.getByRole('button', { name: new RegExp(`Continuer comme ${assignedName}`, 'i') });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(1000);
  }
}

async function clickWaveCell(page, surfer, wave) {
  const surferCard = page.locator('.judge-surfer-card').filter({ hasText: surfer }).first();
  await surferCard.waitFor({ timeout: 15000 });
  await surferCard.locator('.judge-wave-cell').nth(wave - 1).click();
}

async function enterScore(page, score) {
  for (const char of score.split('')) {
    await page.getByRole('button', { name: char, exact: true }).click();
  }
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

async function submitScore(page, surfer, wave, score) {
  await clickWaveCell(page, surfer, wave);
  await page.waitForTimeout(300);
  await enterScore(page, score);
  await page.waitForTimeout(1200);
}

async function enableInterferenceMode(page, type = 'INT1') {
  await page.getByRole('button', { name: /Interférence/i }).click();
  const select = page.locator('select').filter({ has: page.locator('option[value="INT1"]') }).first();
  await select.selectOption(type);
  await page.waitForTimeout(500);
}

async function setAdminCorrectionMode(page, mode) {
  const heading = page.getByText('6. CORRECTION DE NOTES', { exact: false });
  await heading.scrollIntoViewIfNeeded();
  await heading.click().catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: new RegExp(mode === 'interference' ? 'Mode interférence' : 'Mode note', 'i') }).click();
  await page.waitForTimeout(500);
}

async function selectAdminFormOption(page, label, valueText) {
  const row = page.locator('text=' + label).first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  const select = row.locator('xpath=following::select[1]').first();
  await select.selectOption({ label: valueText }).catch(async () => {
    const options = await select.locator('option').allTextContents();
    const target = options.find((option) => option.trim() === valueText || option.includes(valueText));
    if (!target) throw new Error(`Option ${valueText} introuvable pour ${label}: ${options.join(' | ')}`);
    await select.selectOption({ label: target });
  });
  await page.waitForTimeout(500);
}

async function getVisibleText(page) {
  return page.locator('body').innerText();
}

async function main() {
  await ensureDir(artifactsDir);
  const browser = await launchBrowser();
  const results = {
    meta: {
      baseUrl,
      eventId,
      podium,
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH || null,
      exactBlueTest: 'DEFERRED TO FINAL BECAUSE BLUE IS NOT IN R1 H1',
    },
    evidence: {},
  };

  try {
    const live = {};
    for (const [name, route, viewport] of [
      ['admin', `/admin?eventId=${eventId}`, { width: 1440, height: 2200 }],
      ['j1', `/judge?eventId=${eventId}&position=J1&podium=${podium}`, { width: 1280, height: 900 }],
      ['j2', `/judge?eventId=${eventId}&position=J2&podium=${podium}`, { width: 1280, height: 900 }],
      ['j3', `/judge?eventId=${eventId}&position=J3&podium=${podium}`, { width: 1280, height: 900 }],
      ['display', `/display?eventId=${eventId}&podium=${podium}`, { width: 1440, height: 1200 }],
    ]) {
      const telemetry = { console: [], requests: [], responses: [], failures: [] };
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await attachTelemetry(page, telemetry);
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      live[name] = { context, page, telemetry };
      results.evidence[`${name}_initial`] = await capture(page, `${name}_initial`);
    }

    await loginJudge(live.j1.page, judgeNames.j1);
    await loginJudge(live.j2.page, judgeNames.j2);
    await loginJudge(live.j3.page, judgeNames.j3);
    await live.admin.page.waitForTimeout(2000);
    await live.display.page.waitForTimeout(2000);

    results.evidence.after_login = {
      admin: await capture(live.admin.page, 'admin_after_login'),
      j1: await capture(live.j1.page, 'j1_after_login'),
      j2: await capture(live.j2.page, 'j2_after_login'),
      j3: await capture(live.j3.page, 'j3_after_login'),
      display: await capture(live.display.page, 'display_after_login'),
    };

    const scoreLog = [];
    for (const [judgeKey, surfer, wave, score] of scorePlan) {
      await submitScore(live[judgeKey].page, surfer, wave, score);
      scoreLog.push({ judgeKey, judgeName: judgeNames[judgeKey], surfer, wave, score, at: new Date().toISOString() });
      await live.admin.page.waitForTimeout(1000);
      await live.display.page.waitForTimeout(1000);
    }
    results.scoreLog = scoreLog;
    results.evidence.after_primary_scoring = {
      admin: await capture(live.admin.page, 'admin_after_primary_scoring'),
      display: await capture(live.display.page, 'display_after_primary_scoring'),
      j1: await capture(live.j1.page, 'j1_after_primary_scoring'),
    };

    await enableInterferenceMode(live.j1.page, 'INT1');
    await enableInterferenceMode(live.j2.page, 'INT1');
    await clickWaveCell(live.j1.page, 'JAUNE', 2);
    await live.j1.page.waitForTimeout(1200);
    await clickWaveCell(live.j2.page, 'JAUNE', 2);
    await live.j2.page.waitForTimeout(1500);
    await live.admin.page.waitForTimeout(2500);
    await live.display.page.waitForTimeout(2500);
    results.evidence.after_interference = {
      admin: await capture(live.admin.page, 'admin_after_interference'),
      display: await capture(live.display.page, 'display_after_interference'),
      j1: await capture(live.j1.page, 'j1_after_interference'),
      j2: await capture(live.j2.page, 'j2_after_interference'),
    };

    await setAdminCorrectionMode(live.admin.page, 'score');
    await selectAdminFormOption(live.admin.page, 'JUGE', 'CHARLES');
    await selectAdminFormOption(live.admin.page, 'SURFEUR', 'ROUGE');
    await selectAdminFormOption(live.admin.page, 'VAGUE', '3');
    results.evidence.admin_override_source_selected = await capture(live.admin.page, 'admin_override_source_selected');

    const adminText = await getVisibleText(live.admin.page);
    results.overrideUiText = adminText.slice(adminText.indexOf('6. CORRECTION DE NOTES'), adminText.indexOf('7. JOURNAL D’AUDIT DU HEAT'));

    const moveButton = live.admin.page.getByRole('button', { name: /Déplacer la note/i });
    const hasMoveButton = await moveButton.count();
    results.overrideCapabilities = { hasMoveButton: Boolean(hasMoveButton) };

    if (hasMoveButton) {
      await selectAdminFormOption(live.admin.page, 'SURFEUR CIBLE', 'JAUNE');
      await selectAdminFormOption(live.admin.page, 'VAGUE CIBLE', '4');
      const comment = live.admin.page.getByRole('textbox').last();
      if (await comment.count()) {
        await comment.fill('P2.7.14 override valide R1 H1: ROUGE V3 → JAUNE V4; BLEU absent sur ce heat.');
      }
      await moveButton.click();
      await live.admin.page.waitForTimeout(2500);
      await live.display.page.waitForTimeout(2500);
      await live.j1.page.waitForTimeout(1500);
      results.evidence.after_override = {
        admin: await capture(live.admin.page, 'admin_after_override'),
        display: await capture(live.display.page, 'display_after_override'),
        j1: await capture(live.j1.page, 'j1_after_override'),
      };
    }

    results.telemetry = {
      admin: live.admin.telemetry,
      display: live.display.telemetry,
      j1: live.j1.telemetry,
      j2: live.j2.telemetry,
      j3: live.j3.telemetry,
    };

    for (const key of Object.keys(live)) {
      await live[key].context.close();
    }
  } finally {
    await browser.close();
  }

  const outFile = path.join(artifactsDir, 'run.json');
  await fs.writeFile(outFile, JSON.stringify(results, null, 2));
  process.stdout.write(`${outFile}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
