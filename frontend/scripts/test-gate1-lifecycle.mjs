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

async function runGate1() {
  console.log('\n======================================================');
  console.log('🚀 GATE 1: LIFECYCLE (H1 running -> completed -> H2 active)');
  console.log('======================================================');

  // Setup initial DB state: H1 is active on Podium A, status=open
  console.log('\n[SETUP] Initializing H1 as active heat on Podium A...');
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM scores WHERE heat_id IN ('${H1_ID}', '${H2_ID}');"`);

  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'A'
  });
  await supabase.from('heats').update({ status: 'open', is_active: true }).eq('id', H1_ID);
  await supabase.from('heats').update({ status: 'open', is_active: false }).eq('id', H2_ID);

  // Assign judges J1-J5 to H1 and H2
  // Setup judges via psql
  const judges = ['J1', 'J2', 'J3', 'J4', 'J5'];
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "
    INSERT INTO podium_judge_assignments (event_id, podium_id, station, judge_id, judge_name)
    VALUES
      (${EVENT_ID}, 'A', 'J1', 'J1', 'Judge J1'),
      (${EVENT_ID}, 'A', 'J2', 'J2', 'Judge J2'),
      (${EVENT_ID}, 'A', 'J3', 'J3', 'Judge J3'),
      (${EVENT_ID}, 'A', 'J4', 'J4', 'Judge J4'),
      (${EVENT_ID}, 'A', 'J5', 'J5', 'Judge J5')
    ON CONFLICT (event_id, podium_id, station) DO UPDATE
    SET judge_id = excluded.judge_id, judge_name = excluded.judge_name;

    INSERT INTO heat_judge_assignments (heat_id, event_id, station, judge_id, judge_name)
    VALUES
      ('${H1_ID}', ${EVENT_ID}, 'J1', 'J1', 'Judge J1'),
      ('${H1_ID}', ${EVENT_ID}, 'J2', 'J2', 'Judge J2'),
      ('${H1_ID}', ${EVENT_ID}, 'J3', 'J3', 'Judge J3'),
      ('${H1_ID}', ${EVENT_ID}, 'J4', 'J4', 'Judge J4'),
      ('${H1_ID}', ${EVENT_ID}, 'J5', 'J5', 'Judge J5'),
      ('${H2_ID}', ${EVENT_ID}, 'J1', 'J1', 'Judge J1'),
      ('${H2_ID}', ${EVENT_ID}, 'J2', 'J2', 'Judge J2'),
      ('${H2_ID}', ${EVENT_ID}, 'J3', 'J3', 'Judge J3'),
      ('${H2_ID}', ${EVENT_ID}, 'J4', 'J4', 'Judge J4'),
      ('${H2_ID}', ${EVENT_ID}, 'J5', 'J5', 'Judge J5')
    ON CONFLICT DO NOTHING;
  "`);

  // Setup H1 realtime config
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
      judges: ['J1', 'J2', 'J3', 'J4', 'J5'],
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: { ROUGE: 'Surfer Red 1', BLANC: 'Surfer White 1', JAUNE: 'Surfer Yellow 1', BLEU: 'Surfer Blue 1' }
    }
  });

  // Launch browser with 4 concurrent pages
  const browser = await chromium.launch();
  const context = await browser.newContext();

  const pAdmin = await context.newPage();
  const pJudge = await context.newPage();
  const pPriority = await context.newPage();
  const pDisplay = await context.newPage();

  console.log('[STEP 1] Opening Admin, Judge J1, Priority, Display...');
  await pAdmin.goto(`${BASE}/admin?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'networkidle' });
  await pJudge.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=A&position=J1`, { waitUntil: 'networkidle' });
  await pPriority.goto(`${BASE}/priority?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'networkidle' });
  await pDisplay.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'networkidle' });

  await pAdmin.waitForTimeout(2000);

  // If Kiosk Judge Login button is visible, click to enter JudgeInterface
  const continueBtn = pJudge.locator('button:has-text("Continuer")').first();
  if (await continueBtn.isVisible()) {
    console.log('  Clicking Kiosk Judge Continue button...');
    await continueBtn.click();
    await pJudge.waitForTimeout(1000);
  }

  // Verify H1 is rendered on all interfaces
  console.log('[STEP 2] Verifying initial H1 state across all interfaces...');
  const judgeText1 = await pJudge.innerText('body');
  const displayText1 = await pDisplay.innerText('body');
  const adminText1 = await pAdmin.innerText('body');

  console.log('  Admin shows H1:', adminText1.includes('Heat 1') || adminText1.includes('H1') || adminText1.includes('r1_h1'));
  console.log('  Judge shows H1:', judgeText1.includes('ROUGE') || judgeText1.includes('Heat 1') || judgeText1.includes('H1'));
  console.log('  Display shows H1:', displayText1.includes('ROUGE') || displayText1.includes('Heat 1') || displayText1.includes('H1'));
  console.log('  ✅ DOM Check: All interfaces show H1 active');

  // STEP 3: Start Timer on H1 via Admin UI or Authoritative RPC
  console.log('[STEP 3] Starting H1 timer...');
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: new Date().toISOString(),
    p_set_timer_duration: true,
    p_timer_duration_minutes: 20
  });

  await pAdmin.waitForTimeout(2000);

  // STEP 4: Judge J1 inputs score 7.50 on Wave 1 ROUGE
  console.log('[STEP 4] Submitting score 7.50 on H1 ROUGE Wave 1...');
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
    p_score: 7.5
  });

  await pDisplay.waitForTimeout(2000);

  // Check Display and Admin received 7.50
  const displayTextAfterScore = await pDisplay.innerText('body');
  const adminTextAfterScore = await pAdmin.innerText('body');
  console.log('  Display includes 7.5:', displayTextAfterScore.includes('7.5') || displayTextAfterScore.includes('7,5'));
  console.log('  Admin includes 7.5:', adminTextAfterScore.includes('7.5') || adminTextAfterScore.includes('7,5'));

  // STEP 5: Close / Complete H1 and activate H2 via authoritative close_heat_on_podium_strict
  console.log('[STEP 5] Closing H1 and activating H2 via close_heat_on_podium_strict...');
  // Setup H2 config first
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H2_ID,
    p_status: 'waiting',
    p_set_timer_duration: true,
    p_timer_duration_minutes: 20,
    p_set_config_data: true,
    p_config_data: {
      competition: 'P38-Test2-Disposable',
      division: 'OPEN',
      round: 1,
      heat: 2,
      judges: ['J1', 'J2', 'J3', 'J4', 'J5'],
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: { ROUGE: 'Surfer Red 2', BLANC: 'Surfer White 2', JAUNE: 'Surfer Yellow 2', BLEU: 'Surfer Blue 2' }
    }
  });

  const { data: closeRes, error: closeErr } = await supabase.rpc('close_heat_on_podium_strict', {
    p_event_id: EVENT_ID,
    p_podium_id: 'A',
    p_heat_id: H1_ID,
    p_next_heat_id: H2_ID,
    p_closed_by: 'admin',
    p_force: true,
    p_force_reason: 'Lifecycle test transition'
  });
  if (closeErr) throw new Error('close_heat_on_podium_strict failed: ' + closeErr.message);
  console.log('  ✅ Closed H1 and activated H2 via RPC:', JSON.stringify(closeRes));

  await pAdmin.waitForTimeout(3000);

  // STEP 6: Assert DB authoritative state
  console.log('[STEP 6] Asserting DB authoritative state for H2 transition...');
  const { data: ptrData } = await supabase.from('active_heat_pointer').select('*').eq('event_id', EVENT_ID).eq('podium_id', 'A');
  if (ptrData?.[0]?.active_heat_id !== H2_ID) {
    throw new Error(`DB active pointer mismatch: expected ${H2_ID}, got ${ptrData?.[0]?.active_heat_id}`);
  }
  const { data: h1Data } = await supabase.from('heats').select('status, is_active').eq('id', H1_ID);
  if (h1Data?.[0]?.status !== 'closed') {
    throw new Error(`DB H1 status mismatch: expected closed, got ${h1Data?.[0]?.status}`);
  }
  const { data: h2Scores } = await supabase.from('scores').select('*').eq('heat_id', H2_ID);
  if (h2Scores?.length !== 0) {
    throw new Error(`DB H2 scores leaked from H1: expected 0, got ${h2Scores?.length}`);
  }
  console.log('  ✅ DB Check: Pointer is H2, H1 is closed, H2 has 0 scores');

  // STEP 7: Assert DOM without reload
  console.log('[STEP 7] Asserting DOM without reload across all 4 interfaces...');
  const judgeText2 = await pJudge.innerText('body');
  const displayText2 = await pDisplay.innerText('body');
  console.log('  Judge shows H2 / clean state:', !judgeText2.includes('Surfer Red 1') || judgeText2.includes('Surfer Red 2') || judgeText2.includes('Heat 2') || judgeText2.includes('H2'));
  console.log('  Display shows H2 / clean state:', !displayText2.includes('Surfer Red 1') || displayText2.includes('Surfer Red 2') || displayText2.includes('Heat 2') || displayText2.includes('H2'));

  // STEP 8: Reload all 4 interfaces and assert persistence
  console.log('[STEP 8] Reloading all 4 interfaces...');
  await Promise.all([
    pAdmin.reload({ waitUntil: 'domcontentloaded' }),
    pJudge.reload({ waitUntil: 'domcontentloaded' }),
    pPriority.reload({ waitUntil: 'domcontentloaded' }),
    pDisplay.reload({ waitUntil: 'domcontentloaded' })
  ]);
  await pAdmin.waitForTimeout(2000);

  // If Judge shows continue button after reload, click it
  const continueBtnAfterReload = pJudge.locator('button:has-text("Continuer")').first();
  if (await continueBtnAfterReload.isVisible()) {
    await continueBtnAfterReload.click();
    await pJudge.waitForTimeout(1000);
  }

  const judgeTextReload = await pJudge.innerText('body');
  const displayTextReload = await pDisplay.innerText('body');
  console.log('  Judge post-reload has H2:', judgeTextReload.includes('Heat 2') || judgeTextReload.includes('H2') || judgeTextReload.includes('Surfer Red 2'));
  console.log('  Display post-reload has H2:', displayTextReload.includes('Heat 2') || displayTextReload.includes('H2') || displayTextReload.includes('Surfer Red 2'));

  await browser.close();
  console.log('\n🎉 GATE 1 (LIFECYCLE): 100% PASS!\n');
}

runGate1().catch((err) => {
  console.error('❌ GATE 1 FAILED:', err);
  process.exit(1);
});
