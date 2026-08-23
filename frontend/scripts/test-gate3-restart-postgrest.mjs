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

async function runGate3() {
  console.log('\n======================================================');
  console.log('🚀 GATE 3: RESTART POSTGREST (Resilience & Zero Duplication)');
  console.log('======================================================');

  // Setup initial DB state
  console.log('\n[SETUP] Initializing H1 as active heat on Podium A...');
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM scores WHERE heat_id = '${H1_ID}';"`);

  await supabase.from('heats').update({ status: 'open', is_active: true }).eq('id', H1_ID);
  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'A'
  });

  // Assign judges J1-J5
  const judges = ['J1', 'J2', 'J3', 'J4', 'J5'];
  for (const j of judges) {
    await supabase.from('heat_judge_assignments').upsert({
      heat_id: H1_ID,
      event_id: EVENT_ID,
      station: j,
      judge_id: j,
      judge_name: `Judge ${j}`
    });
  }

  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: new Date().toISOString(),
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
      surferNames: { ROUGE: 'Surfer Red 1', BLANC: 'Surfer White 1', JAUNE: 'Surfer Yellow 1', BLEU: 'Surfer Blue 1' }
    }
  });

  // Open browser pages: Admin, Judge J1, Display
  const browser = await chromium.launch();
  const context = await browser.newContext();

  const pAdmin = await context.newPage();
  const pJudge = await context.newPage();
  const pDisplay = await context.newPage();

  console.log('[STEP 1] Opening Admin, Judge J1, Display...');
  await pAdmin.goto(`${BASE}/admin?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });
  await pJudge.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=A&position=J1`, { waitUntil: 'domcontentloaded' });
  await pDisplay.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });

  await pAdmin.waitForTimeout(2000);

  const continueBtn = pJudge.locator('button:has-text("Continuer")').first();
  if (await continueBtn.isVisible()) {
    await continueBtn.click();
    await pJudge.waitForTimeout(500);
  }

  // STEP 2: Restart PostgREST container
  console.log('[STEP 2] Restarting PostgREST container (surfjudging_p38_manonman_test2_rest)...');
  execSync('docker restart surfjudging_p38_manonman_test2_rest');

  // Wait for PostgREST to restart and respond HTTP 200
  console.log('  Waiting for PostgREST health recovery...');
  let recovered = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://localhost:18400/rest/v1/events?id=eq.10004', {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
      });
      if (res.status === 200) {
        recovered = true;
        console.log(`  ✅ PostgREST recovered in ${(i + 1) * 500}ms (HTTP 200)`);
        break;
      }
    } catch {
      // connecting
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!recovered) throw new Error('PostgREST failed to recover after restart');

  await pAdmin.waitForTimeout(1500);

  // STEP 3: Perform a real mutation post-restart
  console.log('[STEP 3] Performing mutation: submitting score 9.20 on Wave 1 BLANC...');
  const scoreId = crypto.randomUUID();
  await supabase.rpc('upsert_score_secure', {
    p_id: scoreId,
    p_heat_id: H1_ID,
    p_event_id: EVENT_ID,
    p_competition: 'P38-Test2-Disposable',
    p_division: 'OPEN',
    p_round: 1,
    p_judge_id: 'J1',
    p_judge_name: 'Judge J1',
    p_judge_station: 'J1',
    p_surfer: 'BLANC',
    p_wave_number: 1,
    p_score: 9.2
  });

  await pDisplay.waitForTimeout(2500);

  // STEP 4: Assert DB state and zero duplicates
  console.log('[STEP 4] Asserting DB state and zero duplication...');
  const { data: scores } = await supabase.from('scores').select('*').eq('heat_id', H1_ID);
  if (scores?.length !== 1) throw new Error(`Expected exactly 1 score, got ${scores?.length}`);
  if (scores?.[0]?.score !== 9.2) throw new Error(`Expected score 9.2, got ${scores?.[0]?.score}`);
  console.log('  ✅ DB Check: exactly 1 score (9.2) in DB');

  // STEP 5: Assert DOM propagation without manual page reload
  console.log('[STEP 5] Asserting DOM propagation on Display and Admin without reload...');
  const textDisplay = await pDisplay.innerText('body');
  const textAdmin = await pAdmin.innerText('body');
  if (!textDisplay.includes('9.2') && !textDisplay.includes('9,2')) throw new Error('Display did not receive 9.2 score post-restart');
  if (!textAdmin.includes('9.2') && !textAdmin.includes('9,2')) throw new Error('Admin did not receive 9.2 score post-restart');
  console.log('  ✅ DOM Check: Display and Admin rendered 9.2 score automatically');

  await browser.close();
  console.log('\n🎉 GATE 3 (RESTART POSTGREST): 100% PASS!\n');
}

runGate3().catch((err) => {
  console.error('❌ GATE 3 FAILED:', err);
  process.exit(1);
});
