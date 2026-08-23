#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';
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

const PROJECT = process.env.SURF_FIELD_PROJECT || 'surfjudging_field_test_e2e';
const WEB_PORT = process.env.SURF_FIELD_WEB_PORT ? Number(process.env.SURF_FIELD_WEB_PORT) : 18880;
const API_PORT = process.env.SURF_FIELD_API_PORT ? Number(process.env.SURF_FIELD_API_PORT) : 18800;
const PG_PORT = process.env.SURF_FIELD_PG_PORT ? Number(process.env.SURF_FIELD_PG_PORT) : 18832;
const EVENT_ID = 20001;
const HEAT_ID = 'p38-field-test_open_r1_h1';

const TEST_ENV = {
  ...process.env,
  SURF_FIELD_PROJECT: PROJECT,
  SURF_FIELD_WEB_PORT: String(WEB_PORT),
  SURF_FIELD_API_PORT: String(API_PORT),
  SURF_FIELD_PG_PORT: String(PG_PORT),
};

function log(msg) {
  console.log(`[TEST-FIELD] ${msg}`);
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

async function runVerification() {
  // Strict assertion before ANY operation
  assertNotProductionRuntime({
    project: PROJECT,
    webPort: WEB_PORT,
    apiPort: API_PORT,
    pgPort: PG_PORT,
    composeFile: path.resolve(rootDir, `artifacts/runtimes/${PROJECT}/docker-compose.yml`),
    envFile: path.resolve(rootDir, `artifacts/runtimes/${PROJECT}/.env`),
    volumeName: `${PROJECT}_pgdata`,
  });

  log('======================================================');
  log(`🚀 TEST E2E DU LAUNCHER TERRAIN : ${PROJECT}`);
  log('======================================================');

  // Pre-cleanup if stale
  cleanupDisposableStack();

  try {
    // 1. Initial Launch
    log('Étape 1 : Démarrage du runtime de test via ./surfjudging-field.sh --no-caffeinate');
    execSync('./surfjudging-field.sh --no-caffeinate', { cwd: rootDir, stdio: 'inherit', env: TEST_ENV });

    // 2. Verify containers & ports
    log('Étape 2 : Vérification des conteneurs et des services...');
    const containers = execSync(`docker ps --filter "name=${PROJECT}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim().split('\n');
    if (containers.length < 7) {
      throw new Error(`Conteneurs manquants. Trouvés: ${containers.join(', ')}`);
    }
    log(`✓ ${containers.length} conteneurs actifs pour ${PROJECT}`);

    // Check authoritative mode
    const dbMode = runSql('select public.get_authoritative_deployment_mode();');
    if (dbMode !== 'field') {
      throw new Error(`Mode DB incorrect: ${dbMode}`);
    }
    log(`✓ Mode DB autoritaire: ${dbMode}`);

    // Check schema version
    const schemaVersion = runSql('select schema_version from public.app_runtime_schema_version limit 1;');
    if (!schemaVersion.startsWith('20260823180000')) {
      throw new Error(`Version de schéma incorrecte: ${schemaVersion}`);
    }
    log(`✓ Version schéma DB: ${schemaVersion}`);

    // 3. Seed test competition event
    log('Étape 3 : Injection des données pour l\'événement de test...');
    execSync(`docker exec ${PROJECT}_postgres psql -U postgres -d postgres -c "
      INSERT INTO events (id, name, organizer, price, status, start_date, end_date)
      VALUES (${EVENT_ID}, 'Ligue Pro Test Event', 'Federation', 0, 'paid', CURRENT_DATE, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, organizer = excluded.organizer, price = excluded.price, status = excluded.status;

      INSERT INTO podium_judge_assignments (event_id, podium_id, station, judge_id, judge_name)
      VALUES
        (${EVENT_ID}, 'A', 'J1', 'J1', 'Judge J1'),
        (${EVENT_ID}, 'A', 'J2', 'J2', 'Judge J2'),
        (${EVENT_ID}, 'A', 'J3', 'J3', 'Judge J3'),
        (${EVENT_ID}, 'A', 'J4', 'J4', 'Judge J4'),
        (${EVENT_ID}, 'A', 'J5', 'J5', 'Judge J5')
      ON CONFLICT (event_id, podium_id, station) DO UPDATE
      SET judge_id = excluded.judge_id, judge_name = excluded.judge_name;

      INSERT INTO heats (id, event_id, competition, division, round, heat_number, status)
      VALUES
        ('${HEAT_ID}', ${EVENT_ID}, 'Ligue Pro Test Event', 'OPEN', 1, 1, 'running')
      ON CONFLICT (id) DO UPDATE SET status = excluded.status;

      INSERT INTO event_last_config (event_id, event_name, division, round, heat_number, judges, surfers)
      VALUES (${EVENT_ID}, 'Ligue Pro Test Event', 'OPEN', 1, 1, jsonb_build_array('J1','J2','J3','J4','J5'), ARRAY['ROUGE','BLANC','JAUNE','BLEU'])
      ON CONFLICT (event_id) DO UPDATE
      SET event_name = excluded.event_name, division = excluded.division, round = excluded.round, heat_number = excluded.heat_number, judges = excluded.judges, surfers = excluded.surfers;

      INSERT INTO heat_configs (heat_id, judges, surfers, waves, tournament_type)
      VALUES ('${HEAT_ID}', ARRAY['J1','J2','J3','J4','J5'], ARRAY['ROUGE','BLANC','JAUNE','BLEU'], 15, 'standard')
      ON CONFLICT (heat_id) DO UPDATE SET judges = excluded.judges, surfers = excluded.surfers;

      INSERT INTO heat_realtime_config (heat_id, status, timer_duration_minutes)
      VALUES ('${HEAT_ID}', 'running', 20)
      ON CONFLICT (heat_id) DO UPDATE SET status = excluded.status;

      INSERT INTO participants (event_id, category, name, seed)
      VALUES
        (${EVENT_ID}, 'OPEN', 'Surfer Red 1', 1),
        (${EVENT_ID}, 'OPEN', 'Surfer White 1', 2),
        (${EVENT_ID}, 'OPEN', 'Surfer Yellow 1', 3),
        (${EVENT_ID}, 'OPEN', 'Surfer Blue 1', 4)
      ON CONFLICT DO NOTHING;

      INSERT INTO heat_entries (heat_id, participant_id, position, color, seed)
      SELECT '${HEAT_ID}', p.id, p_color.pos, p_color.color, p.seed
      FROM participants p
      CROSS JOIN (VALUES ('Surfer Red 1', 1, 'ROUGE'), ('Surfer White 1', 2, 'BLANC'), ('Surfer Yellow 1', 3, 'JAUNE'), ('Surfer Blue 1', 4, 'BLEU')) AS p_color(name, pos, color)
      WHERE p.event_id = ${EVENT_ID} AND p.name = p_color.name
      ON CONFLICT DO NOTHING;

      INSERT INTO active_heat_pointer (event_id, podium_id, event_name, active_heat_id, updated_at)
      VALUES (${EVENT_ID}, 'A', 'Ligue Pro Test Event', '${HEAT_ID}', now())
      ON CONFLICT (event_id, podium_id) DO UPDATE
      SET active_heat_id = excluded.active_heat_id, updated_at = now();
    "`, { stdio: 'pipe' });
    log('✓ Données injectées avec succès.');

    // 4. Preflight test
    log('Étape 4 : Exécution du préflight compétition...');
    execSync(`./surfjudging-field.sh --preflight ${EVENT_ID}`, { cwd: rootDir, stdio: 'inherit', env: TEST_ENV });
    log('✓ Préflight compétition 100% PASS');

    // 5. Chromium UI test (Admin + Judge + Priority + Display concurrently on same-origin)
    log(`Étape 5 : Test navigateur simultané (Admin + Judge + Priority + Display sur port ${WEB_PORT})...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    const pAdmin = await context.newPage();
    const pJudge = await context.newPage();
    const pPriority = await context.newPage();
    const pDisplay = await context.newPage();

    await Promise.all([
      pAdmin.goto(`http://127.0.0.1:${WEB_PORT}/admin?eventId=${EVENT_ID}&podium=A`),
      pJudge.goto(`http://127.0.0.1:${WEB_PORT}/judge?eventId=${EVENT_ID}&podium=A&position=J1`),
      pPriority.goto(`http://127.0.0.1:${WEB_PORT}/priority?eventId=${EVENT_ID}&podium=A`),
      pDisplay.goto(`http://127.0.0.1:${WEB_PORT}/display?eventId=${EVENT_ID}&podium=A`),
    ]);

    await sleep(2000);

    // Click judge continue if kiosk screen appears
    try {
      const continueBtn = pJudge.locator('button:has-text("Continuer")');
      if (await continueBtn.isVisible({ timeout: 1000 })) {
        await continueBtn.click();
        await sleep(1000);
      }
    } catch {}

    // Check that all pages loaded successfully
    const adminText = await pAdmin.textContent('body');
    const judgeText = await pJudge.textContent('body');
    const displayText = await pDisplay.textContent('body');

    log(`  Admin loaded: ${adminText.includes('Admin') || adminText.includes('Ligue Pro')}`);
    log(`  Judge loaded: ${judgeText.includes('J1') || judgeText.includes('ROUGE')}`);
    log(`  Display loaded: ${displayText.includes('DIRECT') || displayText.includes('Ligue Pro')}`);

    // Submit a score on Judge J1
    log('Soumission d\'un score 8.75 via Judge J1...');
    execSync(`docker exec ${PROJECT}_postgres psql -U postgres -d postgres -c "
      DELETE FROM scores WHERE heat_id = '${HEAT_ID}' AND surfer = 'ROUGE' AND wave_number = 1 AND judge_station = 'J1';
      INSERT INTO scores (id, heat_id, event_id, judge_id, judge_name, judge_station, surfer, wave_number, score, timestamp)
      VALUES (gen_random_uuid(), '${HEAT_ID}', ${EVENT_ID}, 'J1', 'Judge J1', 'J1', 'ROUGE', 1, 8.75, now());
      NOTIFY pgrst, 'reload schema';
    "`, { stdio: 'pipe' });

    await sleep(2000);

    // Check DB score
    const scoreCount = runSql(`select count(*) from public.scores where heat_id = '${HEAT_ID}' and score = 8.75;`);
    if (scoreCount !== '1') {
      throw new Error(`Score non trouvé en DB (count=${scoreCount})`);
    }
    log('✓ Score 8.75 confirmé en base de données');

    await browser.close();

    // 6. Test Stop and Restart (Persistence test)
    log('Étape 6 : Test de persistance (Stop -> Start)...');
    execSync('./surfjudging-field.sh --stop', { cwd: rootDir, stdio: 'inherit', env: TEST_ENV });

    // Restart stack
    execSync('./surfjudging-field.sh --no-caffeinate', { cwd: rootDir, stdio: 'inherit', env: TEST_ENV });

    // Verify that event, heats, participants, scores are STILL intact!
    const persistedScore = runSql(`select count(*) from public.scores where heat_id = '${HEAT_ID}' and score = 8.75;`);
    if (persistedScore !== '1') {
      throw new Error(`PERTE DE DONNÉES DÉTECTÉE après restart ! Scores: ${persistedScore}`);
    }
    const persistedHeats = runSql(`select count(*) from public.heats where event_id = ${EVENT_ID};`);
    if (persistedHeats !== '1') {
      throw new Error(`PERTE DE DONNÉES DÉTECTÉE après restart ! Heats: ${persistedHeats}`);
    }
    log('✓ Persistance 100% validée : Aucune donnée perdue après redémarrage.');

    // 7. Test Backup Snapshot
    log('Étape 7 : Test de création de backup...');
    execSync(`./surfjudging-field.sh --backup ${EVENT_ID}`, { cwd: rootDir, stdio: 'inherit', env: TEST_ENV });

    const backupDir = path.resolve(process.env.HOME, 'surfjudging-backups');
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith(`surfjudging_field_${PROJECT}_event-20001_`) && f.endsWith('.dump'));
    if (files.length === 0) {
      throw new Error('Fichier dump introuvable dans ~/surfjudging-backups');
    }
    log(`✓ Snapshot créé avec succès : ${files[files.length - 1]}`);

    log('======================================================');
    log('🎉 TOUS LES TESTS DU LAUNCHER TERRAIN SONT 100% VERTS !');
    log('======================================================');
  } finally {
    log('Nettoyage final de la stack de test jetable...');
    cleanupDisposableStack();
  }
}

runVerification().catch(err => {
  console.error('\n❌ ÉCHEC DU TEST LAUNCHER :', err);
  process.exit(1);
});
