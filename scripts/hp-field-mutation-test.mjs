#!/usr/bin/env node

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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
  for (const file of ['frontend/.env.local', 'frontend/.env.production', 'frontend/.env']) {
    try {
      const raw = await fs.readFile(path.join(rootDir, file), 'utf8');
      const line = raw
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith(`${name}=`));
      if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    } catch {
      // Try the next env file.
    }
  }
  return '';
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runHpSql({ hpHost, hpUser, sql }) {
  const remote = 'docker exec -i surfjudging_postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres -t -A -F "|"';
  const result = spawnSync('ssh', [`${hpUser}@${hpHost}`, remote], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `HP SQL failed with exit ${result.status}`,
        result.stderr.trim(),
        result.stdout.trim(),
      ].filter(Boolean).join('\n'),
    );
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function createRestClient(apiBase, key) {
  return async function rest(pathname, options = {}) {
    const response = await fetch(`${apiBase}${pathname}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(options.headers || {}),
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} on ${pathname}: ${body.slice(0, 300)}`);
    }
    return body ? JSON.parse(body) : null;
  };
}

async function latestMigrationVersion() {
  const migrationDir = path.join(rootDir, 'backend/supabase/migrations');
  const entries = await fs.readdir(migrationDir);
  const latest = entries
    .filter((entry) => entry.endsWith('.sql'))
    .filter((entry) => !entry.startsWith('._'))
    .filter((entry) => entry !== 'TEST_MIGRATIONS.sql')
    .sort()
    .at(-1);
  return (latest || '').replace(/\.sql$/, '');
}

function buildSeedSql({ eventName, heatId, heatNumber }) {
  return `
do $$
declare
  v_event_id bigint;
  v_p1 bigint;
  v_p2 bigint;
begin
  select id into v_event_id
  from public.events
  where name = ${sqlLiteral(eventName)}
  order by id
  limit 1;

  if v_event_id is null then
    insert into public.events (
      name,
      organizer,
      start_date,
      end_date,
      price,
      currency,
      method,
      status,
      paid,
      categories,
      judges
    )
    values (
      ${sqlLiteral(eventName)},
      'Codex Field Test',
      current_date,
      current_date,
      0,
      'XOF',
      'field-test',
      'paid',
      true,
      '[{"name":"TEST","participants":2}]'::jsonb,
      '[{"id":"J1","name":"FIELD JUDGE 1","station":"J1","identityId":"J1"}]'::jsonb
    )
    returning id into v_event_id;
  end if;

  update public.events
     set organizer = 'Codex Field Test',
         status = 'paid',
         paid = true,
         categories = '[{"name":"TEST","participants":2}]'::jsonb,
         judges = '[{"id":"J1","name":"FIELD JUDGE 1","station":"J1","identityId":"J1"}]'::jsonb,
         updated_at = now()
   where id = v_event_id;

  insert into public.participants (event_id, category, seed, name, country, license)
  values (v_event_id, 'TEST', 1, 'FIELD TEST RED', 'TST', 'FIELD-RED')
  on conflict (event_id, category, seed)
  do update set name = excluded.name, country = excluded.country, license = excluded.license, updated_at = now()
  returning id into v_p1;

  insert into public.participants (event_id, category, seed, name, country, license)
  values (v_event_id, 'TEST', 2, 'FIELD TEST WHITE', 'TST', 'FIELD-WHITE')
  on conflict (event_id, category, seed)
  do update set name = excluded.name, country = excluded.country, license = excluded.license, updated_at = now()
  returning id into v_p2;

  insert into public.heats (
    id,
    competition,
    division,
    round,
    heat_number,
    heat_size,
    status,
    event_id,
    closed_at,
    is_active,
    updated_at
  )
  values (${sqlLiteral(heatId)}, ${sqlLiteral(eventName)}, 'TEST', 1, ${heatNumber}, 2, 'running', v_event_id, null, true, now())
  on conflict (id)
  do update set
    competition = excluded.competition,
    division = excluded.division,
    round = excluded.round,
    heat_number = excluded.heat_number,
    heat_size = excluded.heat_size,
    status = 'running',
    event_id = excluded.event_id,
    closed_at = null,
    is_active = true,
    updated_at = now();

  insert into public.heat_entries (heat_id, participant_id, position, seed, color)
  select ${sqlLiteral(heatId)}, v_p1, 1, 1, 'ROUGE'
  where not exists (
    select 1 from public.heat_entries where heat_id = ${sqlLiteral(heatId)} and position = 1
  );

  insert into public.heat_entries (heat_id, participant_id, position, seed, color)
  select ${sqlLiteral(heatId)}, v_p2, 2, 2, 'BLANC'
  where not exists (
    select 1 from public.heat_entries where heat_id = ${sqlLiteral(heatId)} and position = 2
  );

  insert into public.heat_configs (heat_id, judges, surfers, judge_names, waves, tournament_type)
  values (
    ${sqlLiteral(heatId)},
    array['J1'],
    array['ROUGE','BLANC'],
    '{"J1":"FIELD JUDGE 1"}'::jsonb,
    4,
    'field-test'
  )
  on conflict (heat_id)
  do update set
    judges = excluded.judges,
    surfers = excluded.surfers,
    judge_names = excluded.judge_names,
    waves = excluded.waves,
    tournament_type = excluded.tournament_type;

  insert into public.heat_judge_assignments (heat_id, event_id, station, judge_id, judge_name, assigned_by)
  values (${sqlLiteral(heatId)}, v_event_id, 'J1', 'J1', 'FIELD JUDGE 1', 'field-mutation-test')
  on conflict (heat_id, station)
  do update set
    event_id = excluded.event_id,
    judge_id = excluded.judge_id,
    judge_name = excluded.judge_name,
    assigned_by = excluded.assigned_by,
    updated_at = now();

  perform public.upsert_event_last_config(
    v_event_id,
    ${sqlLiteral(eventName)},
    'TEST',
    ${heatNumber},
    1,
    '[{"id":"J1","name":"FIELD JUDGE 1","station":"J1","identityId":"J1"}]'::jsonb,
    array['ROUGE','BLANC'],
    '{"ROUGE":"FIELD TEST RED","BLANC":"FIELD TEST WHITE"}'::jsonb,
    '{"ROUGE":"TST","BLANC":"TST"}'::jsonb
  );

  perform public.upsert_heat_realtime_config(
    ${sqlLiteral(heatId)},
    'running',
    true,
    now(),
    true,
    20,
    true,
    jsonb_build_object(
      'competition', ${sqlLiteral(eventName)},
      'division', 'TEST',
      'round', 1,
      'heatId', ${heatNumber},
      'waves', 4,
      'surfers', jsonb_build_array('ROUGE','BLANC'),
      'judges', jsonb_build_array('J1'),
      'judgeNames', jsonb_build_object('J1','FIELD JUDGE 1'),
      'judgeIdentities', jsonb_build_object('J1','J1'),
      'judge_identities', jsonb_build_object('J1','J1'),
      'surferNames', jsonb_build_object('ROUGE','FIELD TEST RED','BLANC','FIELD TEST WHITE'),
      'surferCountries', jsonb_build_object('ROUGE','TST','BLANC','TST')
    ),
    'field-mutation-test'
  );

  perform public.upsert_active_heat_pointer(v_event_id, ${sqlLiteral(eventName)}, ${sqlLiteral(heatId)}, now());
end $$;

select e.id, e.name, h.id, h.status
from public.events e
join public.heats h on h.event_id = e.id
where e.name = ${sqlLiteral(eventName)}
  and h.id = ${sqlLiteral(heatId)}
order by e.id
limit 1;
`;
}

function buildCloseSql(heatId) {
  return `
update public.heats
   set status = 'closed',
       closed_at = now(),
       updated_at = now()
 where id = ${sqlLiteral(heatId)};

select public.upsert_heat_realtime_config(
  ${sqlLiteral(heatId)},
  'closed',
  false,
  null,
  false,
  null,
  false,
  null,
  'field-mutation-test-close'
);

select id, status, closed_at is not null as has_closed_at
from public.heats
where id = ${sqlLiteral(heatId)};
`;
}

async function waitForScore(rest, heatId, waveNumber, score, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  const query = `/scores?select=id,heat_id,surfer,wave_number,score,judge_station&heat_id=eq.${encodeURIComponent(heatId)}&surfer=eq.ROUGE&wave_number=eq.${waveNumber}&judge_station=eq.J1&order=created_at.desc&limit=1`;

  while (Date.now() < deadline) {
    const rows = await rest(query);
    const match = Array.isArray(rows)
      ? rows.find((row) => Number(row.score) === score)
      : null;
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Score ${score} vague ${waveNumber} introuvable pour ${heatId}`);
}

async function countScoresForWave(rest, heatId, waveNumber) {
  const rows = await rest(
    `/scores?select=id&heat_id=eq.${encodeURIComponent(heatId)}&surfer=eq.ROUGE&wave_number=eq.${waveNumber}&judge_station=eq.J1`,
  );
  return Array.isArray(rows) ? rows.length : 0;
}

async function clickKioskContinueIfPresent(page) {
  const continueButton = page.getByRole('button', { name: /continuer/i }).first();
  if (await continueButton.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
    await continueButton.click();
  }
}

async function submitScoreFromJudge(page, scoreText) {
  await page.waitForSelector('.judge-wave-cell:not([disabled])', { timeout: 15000 });
  const targetCell = page.locator('.judge-wave-cell:not([disabled])', { hasText: '✍' }).first();
  await targetCell.waitFor({ state: 'visible', timeout: 5000 });
  const targetText = await targetCell.innerText();
  const waveNumber = Number.parseInt(targetText, 10);
  if (!Number.isFinite(waveNumber) || waveNumber <= 0) {
    throw new Error(`Impossible de déterminer la vague cible depuis: ${targetText}`);
  }
  await targetCell.click();
  await page.waitForSelector('.judge-keypad-panel.is-active', { timeout: 5000 });

  for (const key of scoreText) {
    await page.locator('.judge-keypad-panel button', { hasText: key }).first().click();
  }
  await page.getByRole('button', { name: /ok/i }).last().click();
  return waveNumber;
}

async function waitForHeatSignalSubscription(page, heatId, timeoutMs = 15000) {
  await page.waitForFunction(
    (expectedHeatId) => {
      const raw = window.localStorage.getItem('surfJudgingRuntimeDiagnostics');
      if (!raw) return false;

      try {
        const diagnostics = JSON.parse(raw);
        const realtimeEntries = Array.isArray(diagnostics?.realtime)
          ? diagnostics.realtime
          : [];
        return realtimeEntries.some((entry) =>
          entry?.key === `heat-signals:${expectedHeatId}` &&
          entry?.status === 'subscribed'
        );
      } catch {
        return false;
      }
    },
    heatId,
    { timeout: timeoutMs },
  );
}

async function assertClosedBlocksScoring(page) {
  let closeRealtimeOk = true;
  await page.waitForFunction(
    () => /HEAT CLOTURE|OVER|cl[oô]tur/i.test(document.body.innerText),
    null,
    { timeout: 12000 },
  ).catch(async () => {
    closeRealtimeOk = false;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await clickKioskContinueIfPresent(page);
    await page.waitForFunction(
      () => /HEAT CLOTURE|OVER|cl[oô]tur/i.test(document.body.innerText),
      null,
      { timeout: 12000 },
    );
  });

  const scoreInputBefore = await page.locator('.judge-score-input').count();
  const enabledCell = page.locator('.judge-wave-cell:not([disabled])').first();
  if (await enabledCell.isVisible({ timeout: 2000 }).catch(() => false)) {
    await enabledCell.click();
  }
  await page.waitForTimeout(700);
  const scoreInputAfter = await page.locator('.judge-score-input').count();

  if (scoreInputAfter > scoreInputBefore) {
    throw new Error('Une cellule de score reste activable après fermeture du heat.');
  }

  return closeRealtimeOk;
}

async function main() {
  const hpHost = readArg('host', resolveHpHost());
  const hpUser = process.env.SURF_HP_USER || 'admin-surfjudging';
  const eventName = readArg('event', process.env.SURF_HP_MUTATION_EVENT_NAME || 'FIELD SMOKE TEST');
  const defaultHeatNumber = Math.floor(Date.now() / 1000);
  const heatNumber = Number(readArg('heat-number', process.env.SURF_HP_MUTATION_HEAT_NUMBER || String(defaultHeatNumber)));
  if (!Number.isInteger(heatNumber) || heatNumber <= 0) {
    throw new Error(`heat-number invalide: ${heatNumber}`);
  }
  const heatId = readArg('heat-id', process.env.SURF_HP_MUTATION_HEAT_ID || `field_smoke_test_test_r1_h${heatNumber}`);
  const judgePosition = readArg('judge', process.env.SURF_HP_JUDGE_POSITION || 'J1');
  const webBase = `http://${hpHost}:8080`;
  const apiBase = `http://${hpHost}:8000/rest/v1`;
  const key = (await readEnvValue('VITE_SUPABASE_ANON_KEY_LAN')) || DEFAULT_LOCAL_KEY;
  const rest = createRestClient(apiBase, key);

  const seedLines = runHpSql({ hpHost, hpUser, sql: buildSeedSql({ eventName, heatId, heatNumber }) });
  const seedResult = seedLines.at(-1);
  if (!seedResult) throw new Error('Seed HP vide: aucun event/heat retourné.');
  const [eventIdRaw, seededEventName, seededHeatId, seededStatus] = seedResult.split('|');
  const eventId = Number(eventIdRaw);
  if (!Number.isFinite(eventId)) throw new Error(`Event id invalide après seed: ${seedResult}`);

  const [expectedSchema, installedSchemaRows] = await Promise.all([
    latestMigrationVersion(),
    rest('/app_runtime_schema_version?select=schema_version&limit=1'),
  ]);
  const installedSchema = Array.isArray(installedSchemaRows)
    ? installedSchemaRows[0]?.schema_version || ''
    : '';
  if (expectedSchema !== installedSchema) {
    throw new Error(`Schema HP mismatch: expected=${expectedSchema}, installed=${installedSchema}`);
  }

  const scoreValue = Number((6 + (crypto.randomInt(0, 4) / 10)).toFixed(1));
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

  const requests = [];
  context.on('request', (request) => requests.push(request.url()));

  const judgePage = await context.newPage();
  const displayPage = await context.newPage();
  await Promise.all([
    judgePage.goto(`${webBase}/judge?eventId=${eventId}&position=${encodeURIComponent(judgePosition)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    }),
    displayPage.goto(`${webBase}/display?eventId=${eventId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    }),
  ]);

  await clickKioskContinueIfPresent(judgePage);
  await judgePage.waitForFunction(
    () => /Interface Juge|ROUGE|FIELD TEST RED/i.test(document.body.innerText),
    null,
    { timeout: 15000 },
  ).catch(async (error) => {
    const text = await judgePage.evaluate(() => document.body.innerText.slice(0, 1200));
    throw new Error(`Judge interface not ready: ${error.message}\n${text}`);
  });

  await waitForHeatSignalSubscription(displayPage, heatId).catch(async (error) => {
    const text = await displayPage.evaluate(() => document.body.innerText.slice(0, 1200));
    const diagnostics = await displayPage.evaluate(() =>
      window.localStorage.getItem('surfJudgingRuntimeDiagnostics') || '',
    );
    throw new Error(
      `Display realtime not subscribed before scoring: ${error.message}\n${text}\n${diagnostics.slice(0, 1600)}`,
    );
  });

  const scoredWaveNumber = await submitScoreFromJudge(judgePage, scoreValue.toFixed(1));
  const scoreRow = await waitForScore(rest, heatId, scoredWaveNumber, scoreValue);

  let displayRealtimeOk = true;
  const waitForDisplayScore = async (timeout) => {
    await displayPage.waitForFunction(
      (expectedValues) => expectedValues.some((expected) =>
        document.body.innerText.includes(expected) ||
        document.body.innerText.includes(expected.replace('.', ',')),
      ),
      [scoreValue.toFixed(2), scoreValue.toFixed(1)],
      { timeout },
    );
  };

  await waitForDisplayScore(15000).catch(async () => {
    displayRealtimeOk = false;
    await displayPage.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForDisplayScore(7000);
  });

  const blockedProbeWaveNumber = scoredWaveNumber + 1;
  const wave2BeforeClose = await countScoresForWave(rest, heatId, blockedProbeWaveNumber);
  const closeLines = runHpSql({ hpHost, hpUser, sql: buildCloseSql(heatId) });
  const closeRealtimeOk = await assertClosedBlocksScoring(judgePage);

  const wave2AfterClose = await countScoresForWave(rest, heatId, blockedProbeWaveNumber);
  if (wave2AfterClose !== wave2BeforeClose) {
    throw new Error(`Score ajouté après fermeture: avant=${wave2BeforeClose}, après=${wave2AfterClose}`);
  }

  await browser.close();

  const cloudRequests = requests.filter((url) => url.includes('supabase.co') || url.includes('surfjudging.cloud'));
  const summary = {
    ok: true,
    hpHost,
    event: { id: eventId, name: seededEventName },
    heat: { id: seededHeatId, statusBefore: seededStatus },
    score: scoreRow,
    displayRealtimeOk,
    closeRealtimeOk,
    close: closeLines.at(-1),
    expectedSchema,
    installedSchema,
    cloudRequests: cloudRequests.slice(0, 8),
  };

  if (cloudRequests.length > 0) {
    summary.ok = false;
    console.log(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
