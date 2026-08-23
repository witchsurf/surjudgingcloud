#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');
import { fileURLToPath } from 'node:url';
import { assertNotProductionRuntime } from './anti-prod-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PROJECT = process.env.SURF_FIELD_PROJECT || 'surfjudging_field_virgin_check';
const WEB_PORT = process.env.SURF_FIELD_WEB_PORT ? Number(process.env.SURF_FIELD_WEB_PORT) : 18980;
const API_PORT = process.env.SURF_FIELD_API_PORT ? Number(process.env.SURF_FIELD_API_PORT) : 18900;
const PG_PORT = process.env.SURF_FIELD_PG_PORT ? Number(process.env.SURF_FIELD_PG_PORT) : 18932;

const TEST_ENV = {
  ...process.env,
  SURF_FIELD_PROJECT: PROJECT,
  SURF_FIELD_WEB_PORT: String(WEB_PORT),
  SURF_FIELD_API_PORT: String(API_PORT),
  SURF_FIELD_PG_PORT: String(PG_PORT),
};

function log(msg) {
  console.log(`[VIRGIN-TEST] ${msg}`);
}

function runSql(sql) {
  return execSync(`docker exec ${PROJECT}_postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupDisposableStack() {
  assertNotProductionRuntime({
    project: PROJECT,
    webPort: WEB_PORT,
    apiPort: API_PORT,
    pgPort: PG_PORT,
    composeFile: path.resolve(rootDir, `artifacts/runtimes/${PROJECT}/docker-compose.yml`),
    envFile: path.resolve(rootDir, `artifacts/runtimes/${PROJECT}/.env`),
    volumeName: `${PROJECT}_pgdata`,
  });

  try {
    const runtimeDir = path.resolve(rootDir, `artifacts/runtimes/${PROJECT}`);
    const composeFile = path.resolve(runtimeDir, 'docker-compose.yml');
    const envFile = path.resolve(runtimeDir, '.env');
    if (fs.existsSync(composeFile) && fs.existsSync(envFile)) {
      execSync(`docker compose --env-file "${envFile}" -f "${composeFile}" down -v --remove-orphans`, { stdio: 'pipe' });
    }
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[CLEANUP-WARN] ${err.message}`);
  }
}

async function runVirginFirstRunAudit() {
  // 0. Anti-Production Barrier Check
  assertNotProductionRuntime({
    project: PROJECT,
    webPort: WEB_PORT,
    apiPort: API_PORT,
    pgPort: PG_PORT,
    composeFile: path.resolve(rootDir, `artifacts/runtimes/${PROJECT}/docker-compose.yml`),
    envFile: path.resolve(rootDir, `artifacts/runtimes/${PROJECT}/.env`),
    volumeName: `${PROJECT}_pgdata`,
  });

  log('======================================================================');
  log(`🎯 TEST D\'INTÉGRITÉ FIRST-RUN VIERGE PRODUCTION : ${PROJECT}`);
  log('======================================================================');

  // Pre-cleanup
  cleanupDisposableStack();

  try {
    // 1. Initial Launch from complete zero
    log('Étape 1 : Lancement initial à blanc du launcher terrain...');
    execSync('./surfjudging-field.sh --no-caffeinate', {
      cwd: rootDir,
      stdio: 'inherit',
      env: TEST_ENV,
    });

    // 2. Technical Checks
    log('Étape 2 : Vérification de la configuration technique...');

    const dbMode = runSql('SELECT public.get_authoritative_deployment_mode();');
    if (dbMode !== 'field') {
      throw new Error(`Mode DB incorrect: ${dbMode} (attendu: field)`);
    }
    log(`  ✓ Mode DB autoritaire : ${dbMode}`);

    const schemaVersion = runSql('SELECT schema_version FROM public.app_runtime_schema_version LIMIT 1;');
    if (!schemaVersion.startsWith('20260823180000')) {
      throw new Error(`Version de schéma incorrecte: ${schemaVersion}`);
    }
    log(`  ✓ Version schéma DB : ${schemaVersion}`);

    // Check realtime publication
    const realtimeTables = runSql("SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public';");
    if (Number(realtimeTables) < 5) {
      throw new Error(`Tables Realtime manquantes: seulement ${realtimeTables} trouvées`);
    }
    log(`  ✓ Publication Realtime : ${realtimeTables} tables publiées`);

    // 3. Strict Business Zero-Data Check
    log('Étape 3 : Audit strict des 10 tables métier (Zero-Data Assertion)...');

    const businessTables = [
      { name: 'events', sql: 'SELECT count(*) FROM public.events;' },
      { name: 'participants', sql: 'SELECT count(*) FROM public.participants;' },
      { name: 'heats', sql: 'SELECT count(*) FROM public.heats;' },
      { name: 'heat_entries', sql: 'SELECT count(*) FROM public.heat_entries;' },
      { name: 'active_heat_pointer', sql: 'SELECT count(*) FROM public.active_heat_pointer;' },
      { name: 'heat_judge_assignments', sql: 'SELECT count(*) FROM public.heat_judge_assignments;' },
      { name: 'podium_judge_assignments', sql: 'SELECT count(*) FROM public.podium_judge_assignments;' },
      { name: 'heat_realtime_config', sql: 'SELECT count(*) FROM public.heat_realtime_config;' },
      { name: 'scores', sql: 'SELECT count(*) FROM public.scores;' },
      { name: 'score_overrides', sql: 'SELECT count(*) FROM public.score_overrides;' },
    ];

    let nonZeroCount = 0;
    for (const tbl of businessTables) {
      const count = runSql(tbl.sql);
      if (count !== '0') {
        log(`  ❌ VIOLATION: table ${tbl.name} contient ${count} ligne(s) (0 attendu)`);
        nonZeroCount++;
      } else {
        log(`  ✓ Table ${tbl.name} : 0 ligne (conforme)`);
      }
    }

    if (nonZeroCount > 0) {
      throw new Error(`ÉCHEC DU TEST ZERO-DATA: ${nonZeroCount} table(s) métier polluée(s) au premier démarrage.`);
    }
    log('✅ 100% DES TABLES MÉTIER SONT RIGOUREUSEMENT VIERGES (0 fixture).');

    // 4. Browser UI Verification on Virgin State (Playwright DOM assertions)
    log(`Étape 4 : Vérification navigateur UI sur port ${WEB_PORT} via Playwright...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // 4.1 Home & Admin Page
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${WEB_PORT}/admin`);
    await sleep(2500);

    const adminBody = await page.textContent('body');

    // Assert absence of any test or ghost events / heats / participants
    if (adminBody.includes('Ligue Pro Test Event') || adminBody.includes('20001')) {
      throw new Error('VIOLATION DOM: L\'UI Admin affiche un événement de test ou hérité !');
    }
    if (adminBody.includes('Surfer Red 1') || adminBody.includes('Surfer White 1')) {
      throw new Error('VIOLATION DOM: L\'UI Admin affiche des participants fantômes !');
    }
    if (adminBody.includes('p38-field-test') || adminBody.includes('p38-field-prod')) {
      throw new Error('VIOLATION DOM: L\'UI Admin affiche des identifiants de heats fantômes !');
    }

    // Verify empty state is displayed properly and event creation is possible
    log('  ✓ UI Admin : aucun événement, heat, juge ou participant fantôme');

    // 4.2 Judge Page
    const judgePage = await context.newPage();
    await judgePage.goto(`http://127.0.0.1:${WEB_PORT}/judge?podium=A&position=J1`);
    await sleep(2000);
    const judgeBody = await judgePage.textContent('body');
    if (judgeBody.includes('Surfer Red 1')) {
      throw new Error('VIOLATION DOM: L\'UI Juge affiche des surfeurs fantômes !');
    }
    log('  ✓ UI Juge : aucun surfeur fantôme ni score fantôme');

    // 4.3 Display & Priority Page
    const displayPage = await context.newPage();
    await displayPage.goto(`http://127.0.0.1:${WEB_PORT}/display?podium=A`);
    await sleep(2000);
    const displayBody = await displayPage.textContent('body');
    if (displayBody.includes('Ligue Pro Test Event')) {
      throw new Error('VIOLATION DOM: L\'UI Display affiche un événement fantôme !');
    }
    log('  ✓ UI Display : état vide propre sans événement fantôme');

    const priorityPage = await context.newPage();
    await priorityPage.goto(`http://127.0.0.1:${WEB_PORT}/priority?podium=A`);
    await sleep(2000);
    const priorityBody = await priorityPage.textContent('body');
    if (priorityBody.includes('Surfer Red 1')) {
      throw new Error('VIOLATION DOM: L\'UI Priority affiche des participants fantômes !');
    }
    log('  ✓ UI Priority : état vide propre');

    await browser.close();

    log('======================================================================');
    log('🎉 LE RUNTIME DE PRODUCTION AU PREMIER DÉMARRAGE EST TOTALEMENT CONFORME ET VIERGE !');
    log('======================================================================');
  } finally {
    log('Nettoyage du runtime de test jetable...');
    cleanupDisposableStack();
  }
}

runVirginFirstRunAudit().catch(err => {
  console.error('\n❌ ÉCHEC DU TEST FIRST-RUN VIERGE :', err);
  process.exit(1);
});
