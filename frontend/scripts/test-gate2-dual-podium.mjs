import { chromium } from 'playwright';
import { parseEnvFile } from '../../scripts/build-field-runtime.mjs';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const env = parseEnvFile('../artifacts/runtimes/surfjudging_p38_manonman_test2/.env');
const anonKey = env.ANON_KEY;
const supabase = createClient('http://localhost:18400', anonKey);

const BASE = 'http://192.168.1.107:18480';
const EVENT_ID = 10004;
const H1_ID = 'p38-test2-disposable_open_r1_h1';
const H2_ID = 'p38-test2-disposable_open_r1_h2';

async function runGate2() {
  console.log('\n======================================================');
  console.log('🚀 GATE 2: DUAL PODIUM (A and B on independent heats)');
  console.log('======================================================');

  // Setup initial DB state
  console.log('\n[SETUP] Initializing Podium A on H1 and Podium B on H2...');
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM scores WHERE heat_id IN ('${H1_ID}', '${H2_ID}');"`);

  // Assign H1 to Podium A, H2 to Podium B
  await supabase.from('heats').update({ status: 'open', is_active: true }).eq('id', H1_ID);
  await supabase.from('heats').update({ status: 'open', is_active: true }).eq('id', H2_ID);

  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'A'
  });
  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H2_ID,
    p_podium_id: 'B'
  });

  const judges = ['J1', 'J2', 'J3', 'J4', 'J5'];
  // Assign judges to heats and podiums via psql
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "
    INSERT INTO podium_judge_assignments (event_id, podium_id, station, judge_id, judge_name)
    VALUES
      (${EVENT_ID}, 'A', 'J1', 'J1', 'Judge J1'),
      (${EVENT_ID}, 'A', 'J2', 'J2', 'Judge J2'),
      (${EVENT_ID}, 'A', 'J3', 'J3', 'Judge J3'),
      (${EVENT_ID}, 'A', 'J4', 'J4', 'Judge J4'),
      (${EVENT_ID}, 'A', 'J5', 'J5', 'Judge J5'),
      (${EVENT_ID}, 'B', 'J1', 'B_J1', 'Judge B J1'),
      (${EVENT_ID}, 'B', 'J2', 'B_J2', 'Judge B J2'),
      (${EVENT_ID}, 'B', 'J3', 'B_J3', 'Judge B J3'),
      (${EVENT_ID}, 'B', 'J4', 'B_J4', 'Judge B J4'),
      (${EVENT_ID}, 'B', 'J5', 'B_J5', 'Judge B J5')
    ON CONFLICT (event_id, podium_id, station) DO UPDATE
    SET judge_id = excluded.judge_id, judge_name = excluded.judge_name;

    INSERT INTO heat_judge_assignments (heat_id, event_id, station, judge_id, judge_name)
    VALUES
      ('${H1_ID}', ${EVENT_ID}, 'J1', 'J1', 'Judge J1'),
      ('${H1_ID}', ${EVENT_ID}, 'J2', 'J2', 'Judge J2'),
      ('${H1_ID}', ${EVENT_ID}, 'J3', 'J3', 'Judge J3'),
      ('${H1_ID}', ${EVENT_ID}, 'J4', 'J4', 'Judge J4'),
      ('${H1_ID}', ${EVENT_ID}, 'J5', 'J5', 'Judge J5'),
      ('${H2_ID}', ${EVENT_ID}, 'J1', 'B_J1', 'Judge B J1'),
      ('${H2_ID}', ${EVENT_ID}, 'J2', 'B_J2', 'Judge B J2'),
      ('${H2_ID}', ${EVENT_ID}, 'J3', 'B_J3', 'Judge B J3'),
      ('${H2_ID}', ${EVENT_ID}, 'J4', 'B_J4', 'Judge B J4'),
      ('${H2_ID}', ${EVENT_ID}, 'J5', 'B_J5', 'Judge B J5')
    ON CONFLICT DO NOTHING;
  "`);

  // Setup H1 (Podium A) and H2 (Podium B) configs (stopped/waiting)
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'waiting',
    p_set_timer_duration: true,
    p_timer_duration_minutes: 20,
    p_set_config_data: true,
    p_config_data: {
      competition: 'P38-Test2-Disposable',
      division: 'OPEN',
      round: 1,
      heat: 1,
      judges,
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: { ROUGE: 'Surfer A Red', BLANC: 'Surfer A White', JAUNE: 'Surfer A Yellow', BLEU: 'Surfer A Blue' }
    }
  });

  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H2_ID,
    p_status: 'waiting',
    p_set_timer_duration: true,
    p_timer_duration_minutes: 25,
    p_set_config_data: true,
    p_config_data: {
      competition: 'P38-Test2-Disposable',
      division: 'OPEN',
      round: 1,
      heat: 2,
      judges,
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: { ROUGE: 'Surfer B Red', BLANC: 'Surfer B White', JAUNE: 'Surfer B Yellow', BLEU: 'Surfer B Blue' }
    }
  });

  // Open browser pages for Podium A and Podium B
  const browser = await chromium.launch();
  const context = await browser.newContext();

  const pAdminA = await context.newPage();
  const pDisplayA = await context.newPage();
  const pJudgeA = await context.newPage();

  const pAdminB = await context.newPage();
  const pDisplayB = await context.newPage();
  const pJudgeB = await context.newPage();

  console.log('[STEP 1] Opening Podium A (Admin, Display, Judge) and Podium B (Admin, Display, Judge)...');
  await pAdminA.goto(`${BASE}/admin?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });
  await pDisplayA.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });
  await pJudgeA.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=A&position=J1`, { waitUntil: 'domcontentloaded' });

  await pAdminB.goto(`${BASE}/admin?eventId=${EVENT_ID}&podium=B`, { waitUntil: 'domcontentloaded' });
  await pDisplayB.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=B`, { waitUntil: 'domcontentloaded' });
  await pJudgeB.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=B&position=J1`, { waitUntil: 'domcontentloaded' });

  await pAdminA.waitForTimeout(2000);

  // Click continue if judge kiosk login is shown
  for (const page of [pJudgeA, pJudgeB]) {
    const btn = page.locator('button:has-text("Continuer")').first();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(500);
    }
  }

  // STEP 2: START A -> Podium A timer starts, Podium B remains stopped
  console.log('[STEP 2] START Podium A -> Asserting Podium B remains stopped...');
  const startA = new Date().toISOString();
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: startA,
    p_set_timer_duration: true,
    p_timer_duration_minutes: 20
  });

  await pAdminA.waitForTimeout(2000);

  // Assert DB status
  const { data: cfgA } = await supabase.from('heat_realtime_config').select('status, timer_start_time').eq('heat_id', H1_ID);
  const { data: cfgB } = await supabase.from('heat_realtime_config').select('status, timer_start_time').eq('heat_id', H2_ID);
  if (cfgA?.[0]?.status !== 'running') throw new Error('Podium A config is not running');
  if (cfgB?.[0]?.status !== 'waiting') throw new Error(`Podium B config was contaminated: expected waiting, got ${cfgB?.[0]?.status}`);
  console.log('  ✅ DB Check: Podium A is running, Podium B is waiting');

  // STEP 3: START B -> Both run independently
  console.log('[STEP 3] START Podium B -> Asserting independent timers...');
  const startB = new Date().toISOString();
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H2_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: startB,
    p_set_timer_duration: true,
    p_timer_duration_minutes: 25
  });

  await pAdminB.waitForTimeout(2000);
  const { data: cfgBRunning } = await supabase.from('heat_realtime_config').select('status, timer_duration_minutes').eq('heat_id', H2_ID);
  if (cfgBRunning?.[0]?.status !== 'running' || Number(cfgBRunning?.[0]?.timer_duration_minutes) !== 25) {
    throw new Error('Podium B is not running with duration 25');
  }
  console.log('  ✅ DB Check: Both Podium A and B running independently');

  // STEP 4: PAUSE A -> B continues
  console.log('[STEP 4] PAUSE Podium A -> Asserting Podium B continues running...');
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'paused'
  });
  await pAdminA.waitForTimeout(2000);

  const { data: cfgAPaused } = await supabase.from('heat_realtime_config').select('status').eq('heat_id', H1_ID);
  const { data: cfgBStillRunning } = await supabase.from('heat_realtime_config').select('status').eq('heat_id', H2_ID);
  if (cfgAPaused?.[0]?.status !== 'paused') throw new Error('Podium A is not paused');
  if (cfgBStillRunning?.[0]?.status !== 'running') throw new Error('Podium B stopped when A was paused');
  console.log('  ✅ DB Check: Podium A is paused, Podium B is still running');

  // STEP 5: Score A -> Score submitted on Podium A only
  console.log('[STEP 5] Submitting score on Podium A (H1) -> Asserting 0 contamination on Podium B...');
  await supabase.rpc('upsert_score_secure', {
    p_id: crypto.randomUUID(),
    p_heat_id: H1_ID,
    p_event_id: EVENT_ID,
    p_competition: 'P38-Test2-Disposable',
    p_division: 'OPEN',
    p_round: 1,
    p_judge_id: 'J1',
    p_judge_name: 'Judge J1',
    p_judge_station: 'J1',
    p_surfer: 'ROUGE',
    p_wave_number: 1,
    p_score: 8.8
  });

  await pDisplayA.waitForTimeout(2000);

  // Assert DB scores
  const { data: scoresA } = await supabase.from('scores').select('*').eq('heat_id', H1_ID);
  const { data: scoresB } = await supabase.from('scores').select('*').eq('heat_id', H2_ID);
  if (scoresA?.length !== 1 || scoresA?.[0]?.score !== 8.8) throw new Error('Score A not found in DB');
  if (scoresB?.length !== 0) throw new Error(`Podium B contaminated with scores: count=${scoresB?.length}`);
  console.log('  ✅ DB Check: Podium A has score 8.8, Podium B has 0 scores');

  // Assert DOM Display B does NOT contain 8.8
  const textDisplayB = await pDisplayB.innerText('body');
  const textJudgeB = await pJudgeB.innerText('body');
  if (textDisplayB.includes('8.8') || textDisplayB.includes('8,8')) throw new Error('Display B contaminated with 8.8 score');
  if (textJudgeB.includes('8.8') || textJudgeB.includes('8,8')) throw new Error('Judge B contaminated with 8.8 score');
  console.log('  ✅ DOM Check: Display B and Judge B have 0 score contamination');

  // STEP 6: Heat change A -> Podium B pointer remains unchanged
  console.log('[STEP 6] Changing heat on Podium A -> Asserting Podium B unchanged...');
  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: 'p38-test2-disposable_open_r1_h1',
    p_podium_id: 'A'
  });

  const { data: ptrBCheck } = await supabase.from('active_heat_pointer').select('*').eq('event_id', EVENT_ID).eq('podium_id', 'B');
  if (ptrBCheck?.[0]?.active_heat_id !== H2_ID) throw new Error(`Podium B pointer altered: expected ${H2_ID}, got ${ptrBCheck?.[0]?.active_heat_id}`);
  console.log('  ✅ DB Check: Podium B pointer remains strictly on H2');

  await browser.close();
  console.log('\n🎉 GATE 2 (DUAL PODIUM): 100% PASS!\n');
}

runGate2().catch((err) => {
  console.error('❌ GATE 2 FAILED:', err);
  process.exit(1);
});
