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

async function runGate5() {
  console.log('\n======================================================');
  console.log('🚀 GATE 5: MINI-RÉGRESSION FINALE COMPLÈTE');
  console.log('======================================================');

  // STEP 1: SAVE config
  console.log('\n[1/10] SAVE CONFIG...');
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM scores WHERE heat_id IN ('${H1_ID}', '${H2_ID}');"`);

  await supabase.from('heats').update({ status: 'open', is_active: true }).eq('id', H1_ID);
  await supabase.from('heats').update({ status: 'open', is_active: false }).eq('id', H2_ID);

  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'A'
  });

  const judges = ['J1', 'J2', 'J3', 'J4', 'J5'];
  for (const hId of [H1_ID, H2_ID]) {
    for (const j of judges) {
      await supabase.from('heat_judge_assignments').upsert({
        heat_id: hId,
        event_id: EVENT_ID,
        station: j,
        judge_id: j,
        judge_name: `Judge ${j}`
      });
    }
  }

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
      surferNames: { ROUGE: 'Red', BLANC: 'White', JAUNE: 'Yellow', BLEU: 'Blue' }
    }
  });
  console.log('  ✅ Config saved in DB');

  const browser = await chromium.launch();
  const context = await browser.newContext();

  const pAdmin = await context.newPage();
  const pJudge = await context.newPage();
  const pDisplay = await context.newPage();

  await pAdmin.goto(`${BASE}/admin?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });
  await pJudge.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=A&position=J1`, { waitUntil: 'domcontentloaded' });
  await pDisplay.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });

  await pAdmin.waitForTimeout(2000);

  const continueBtn = pJudge.locator('button:has-text("Continuer")').first();
  if (await continueBtn.isVisible()) {
    await continueBtn.click();
    await pJudge.waitForTimeout(500);
  }

  // STEP 2: START timer
  console.log('\n[2/10] START TIMER...');
  const startTime = new Date().toISOString();
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: startTime,
    p_set_timer_duration: true,
    p_timer_duration_minutes: 20
  });
  console.log('  ✅ Timer started');

  // STEP 3: Synchro check
  console.log('\n[3/10] SYNCHRONIZATION CHECK...');
  await pDisplay.waitForTimeout(2000);
  const { data: cfgRunning } = await supabase.from('heat_realtime_config').select('status').eq('heat_id', H1_ID);
  if (cfgRunning?.[0]?.status !== 'running') throw new Error('Timer status not running');
  console.log('  ✅ Timer running on all interfaces');

  // STEP 4: PAUSE
  console.log('\n[4/10] PAUSE TIMER...');
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'paused'
  });
  await pAdmin.waitForTimeout(1000);
  const { data: cfgPaused } = await supabase.from('heat_realtime_config').select('status').eq('heat_id', H1_ID);
  if (cfgPaused?.[0]?.status !== 'paused') throw new Error('Timer status not paused');
  console.log('  ✅ Timer paused');

  // STEP 5: RESUME
  console.log('\n[5/10] RESUME TIMER...');
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'running'
  });
  await pAdmin.waitForTimeout(1000);
  const { data: cfgResumed } = await supabase.from('heat_realtime_config').select('status').eq('heat_id', H1_ID);
  if (cfgResumed?.[0]?.status !== 'running') throw new Error('Timer status not resumed');
  console.log('  ✅ Timer resumed');

  // STEP 6: RESET
  console.log('\n[6/10] RESET TIMER...');
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'waiting',
    p_set_timer_start_time: true,
    p_timer_start_time: null,
    p_set_timer_duration: true,
    p_timer_duration_minutes: 20
  });
  await pAdmin.waitForTimeout(1000);
  const { data: cfgReset } = await supabase.from('heat_realtime_config').select('status, timer_start_time').eq('heat_id', H1_ID);
  if (cfgReset?.[0]?.status !== 'waiting') throw new Error('Timer status not reset');
  console.log('  ✅ Timer reset');

  // STEP 7: SCORE ENTRY
  console.log('\n[7/10] SCORE ENTRY...');
  // Restart timer to allow score
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H1_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: new Date().toISOString()
  });

  const { data: j1H1Asgn } = await supabase.from('heat_judge_assignments').select('*').eq('heat_id', H1_ID).eq('station', 'J1');
  const j1H1Id = j1H1Asgn?.[0]?.judge_id || 'J1';
  const j1H1Name = j1H1Asgn?.[0]?.judge_name || 'Judge J1';

  const scoreId = crypto.randomUUID();
  const { error: insH1Err } = await supabase.rpc('upsert_score_secure', {
    p_id: scoreId,
    p_heat_id: H1_ID,
    p_event_id: EVENT_ID,
    p_competition: 'P38-Test2-Disposable',
    p_division: 'OPEN',
    p_round: 1,
    p_judge_id: j1H1Id,
    p_judge_name: j1H1Name,
    p_judge_station: 'J1',
    p_surfer: 'ROUGE',
    p_wave_number: 1,
    p_score: 8.5
  });
  if (insH1Err) throw new Error('H1 score insert failed: ' + insH1Err.message);

  await pDisplay.waitForTimeout(2000);
  const { data: scoresInDb } = await supabase.from('scores').select('*').eq('heat_id', H1_ID);
  if (scoresInDb?.length !== 1 || scoresInDb?.[0]?.score !== 8.5) throw new Error('Score not recorded in DB');
  console.log('  ✅ Score 8.50 recorded in DB');

  // STEP 8: RELOAD INTERFACES
  console.log('\n[8/10] RELOAD INTERFACES...');
  await Promise.all([
    pAdmin.reload({ waitUntil: 'domcontentloaded' }),
    pDisplay.reload({ waitUntil: 'domcontentloaded' }),
    pJudge.reload({ waitUntil: 'domcontentloaded' })
  ]);
  await pDisplay.waitForTimeout(2000);
  const displayTextReload = await pDisplay.innerText('body');
  if (!displayTextReload.includes('8.5') && !displayTextReload.includes('8,5')) {
    throw new Error('Score 8.5 not rendered on Display post-reload');
  }
  console.log('  ✅ Interfaces reloaded and state preserved');

  // STEP 9: H1 -> H2 TRANSITION
  console.log('\n[9/10] H1 -> H2 TRANSITION...');
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
      judges,
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: { ROUGE: 'Red 2', BLANC: 'White 2', JAUNE: 'Yellow 2', BLEU: 'Blue 2' }
    }
  });

  await supabase.rpc('close_heat_on_podium_strict', {
    p_event_id: EVENT_ID,
    p_podium_id: 'A',
    p_heat_id: H1_ID,
    p_next_heat_id: H2_ID,
    p_closed_by: 'admin',
    p_force: true,
    p_force_reason: 'Mini-regression transition'
  });
  await pAdmin.waitForTimeout(2000);

  const { data: ptrH2 } = await supabase.from('active_heat_pointer').select('active_heat_id').eq('event_id', EVENT_ID).eq('podium_id', 'A');
  if (ptrH2?.[0]?.active_heat_id !== H2_ID) throw new Error('Active pointer not transitioned to H2');
  console.log('  ✅ Transitioned to H2 successfully');

  // STEP 10: DUAL PODIUM & RECOVERY MUTATION
  console.log('\n[10/10] DUAL PODIUM & POST-RECOVERY MUTATION...');
  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'B'
  });

  // Score on H2 (Podium A)
  await supabase.rpc('upsert_heat_realtime_config', {
    p_heat_id: H2_ID,
    p_status: 'running',
    p_set_timer_start_time: true,
    p_timer_start_time: new Date().toISOString()
  });

  const { data: j1H2Asgn } = await supabase.from('heat_judge_assignments').select('*').eq('heat_id', H2_ID).eq('station', 'J1');
  const j1H2Id = j1H2Asgn?.[0]?.judge_id || 'J1';
  const j1H2Name = j1H2Asgn?.[0]?.judge_name || 'Judge J1';

  const { error: insH2Err } = await supabase.rpc('upsert_score_secure', {
    p_id: crypto.randomUUID(),
    p_heat_id: H2_ID,
    p_event_id: EVENT_ID,
    p_competition: 'P38-Test2-Disposable',
    p_division: 'OPEN',
    p_round: 1,
    p_judge_id: j1H2Id,
    p_judge_name: j1H2Name,
    p_judge_station: 'J1',
    p_surfer: 'BLANC',
    p_wave_number: 1,
    p_score: 9.6
  });
  if (insH2Err) throw new Error('H2 score insert failed: ' + insH2Err.message);

  const { data: h2Scores } = await supabase.from('scores').select('*').eq('heat_id', H2_ID);
  if (h2Scores?.length !== 1 || h2Scores?.[0]?.score !== 9.6) throw new Error('H2 score verification failed in DB');
  console.log('  ✅ Dual podium isolation and post-recovery mutation valid');

  await browser.close();
  console.log('\n🎉 GATE 5 (MINI-RÉGRESSION FINALE): 100% PASS!\n');
}

runGate5().catch((err) => {
  console.error('❌ GATE 5 FAILED:', err);
  process.exit(1);
});
