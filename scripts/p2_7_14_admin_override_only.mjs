#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = path.join(rootDir, 'artifacts', 'p2_7_14_override_only');
const baseUrl = process.env.P2_7_14_BASE_URL || 'http://192.168.1.41:8080';
const eventId = Number(process.env.P2_7_14_EVENT_ID || '10');
const podium = process.env.P2_7_14_PODIUM || 'A';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) return chromium.launch({ headless: true, executablePath });
  return chromium.launch({ headless: true });
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true });
  return {
    url: page.url(),
    title: await page.title(),
    text: await page.locator('body').innerText().catch(() => ''),
  };
}

async function main() {
  await ensureDir(artifactsDir);
  const browser = await launchBrowser();
  const result = { meta: { baseUrl, eventId, podium }, console: [], requests: [], responses: [], failures: [] };
  try {
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 2200 } });
    const displayCtx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const admin = await adminCtx.newPage();
    const display = await displayCtx.newPage();

    for (const page of [admin, display]) {
      page.on('console', (msg) => result.console.push({ page: page === admin ? 'admin' : 'display', type: msg.type(), text: msg.text() }));
      page.on('request', (req) => result.requests.push({ page: page === admin ? 'admin' : 'display', method: req.method(), url: req.url() }));
      page.on('response', (res) => result.responses.push({ page: page === admin ? 'admin' : 'display', status: res.status(), url: res.url() }));
      page.on('requestfailed', (req) => result.failures.push({ page: page === admin ? 'admin' : 'display', method: req.method(), url: req.url(), error: req.failure()?.errorText || 'unknown' }));
    }

    await admin.goto(`${baseUrl}/admin?eventId=${eventId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await display.goto(`${baseUrl}/display?eventId=${eventId}&podium=${podium}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await admin.waitForTimeout(4000);
    await display.waitForTimeout(4000);

    result.before = {
      admin: await capture(admin, 'admin_before'),
      display: await capture(display, 'display_before'),
    };

    const section = admin.getByText('6. CORRECTION DE NOTES', { exact: false });
    await section.scrollIntoViewIfNeeded();
    await section.click().catch(() => {});
    await admin.waitForTimeout(1000);

    const modeNoteButton = admin.getByRole('button', { name: /Mode note/i });
    if (await modeNoteButton.count()) {
      await modeNoteButton.click();
      await admin.waitForTimeout(500);
    }

    const panel = admin.locator('form').filter({ hasText: 'Sélectionner un juge' }).first();
    const selects = panel.locator('select');
    await selects.nth(0).selectOption({ label: 'CHARLES' });
    await admin.waitForTimeout(500);
    await selects.nth(1).selectOption({ label: 'ROUGE' });
    await admin.waitForTimeout(500);
    await selects.nth(2).selectOption({ label: 'Vague 3' }).catch(async () => {
      await selects.nth(2).selectOption('3');
    });
    await admin.waitForTimeout(1200);

    result.selected = await capture(admin, 'admin_selected_source');

    const allSelects = admin.locator('select');
    const totalSelectCount = await allSelects.count();
    result.totalSelectCount = totalSelectCount;

    await allSelects.nth(totalSelectCount - 2).selectOption({ label: 'JAUNE' });
    await admin.waitForTimeout(500);
    await allSelects.nth(totalSelectCount - 1).selectOption({ label: 'Vague 4' }).catch(async () => {
      await allSelects.nth(totalSelectCount - 1).selectOption('4');
    });
    await admin.waitForTimeout(500);

    const commentInput = panel.getByPlaceholder('Optionnel').first();
    if (await commentInput.count()) {
      await commentInput.fill('P2.7.14 test override valide R1 H1 : ROUGE V3 → JAUNE V4; BLEU absent du heat.');
    }

    result.readyToMove = await capture(admin, 'admin_ready_to_move');

    const moveButton = admin.getByRole('button', { name: /Déplacer la note sélectionnée/i });
    await moveButton.click();
    await admin.waitForTimeout(5000);
    await display.waitForTimeout(3000);

    result.after = {
      admin: await capture(admin, 'admin_after'),
      display: await capture(display, 'display_after'),
    };

    await adminCtx.close();
    await displayCtx.close();
  } finally {
    await browser.close();
  }

  const outFile = path.join(artifactsDir, 'run.json');
  await fs.writeFile(outFile, JSON.stringify(result, null, 2));
  process.stdout.write(`${outFile}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
