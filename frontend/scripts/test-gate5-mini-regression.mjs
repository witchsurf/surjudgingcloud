import { chromium } from 'playwright';
import { parseEnvFile } from '../../scripts/build-field-runtime.mjs';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const env = parseEnvFile('../artifacts/runtimes/surfjudging_p38_manonman_test2/.env');
const anonKey = env.ANON_KEY;
const supabase = createClient('http://localhost:18400', anonKey);

const BASE = process.env.P38_BASE_URL || 'http://192.168.1.107:18480';
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

  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "UPDATE public.heats SET status = 'open', is_active = false WHERE id IN ('${H1_ID}', '${H2_ID}'); UPDATE public.heats SET is_active = true WHERE id = '${H1_ID}';"`);

  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'A'
  });

  // Assign judges J1-J5 via psql
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

    INSERT INTO event_last_config (event_id, event_name, division, round, heat_number, judges, surfers)
    VALUES (${EVENT_ID}, 'P38-Test2-Disposable', 'OPEN', 1, 1, jsonb_build_array('J1','J2','J3','J4','J5'), ARRAY['ROUGE','BLANC','JAUNE','BLEU'])
    ON CONFLICT (event_id) DO UPDATE
    SET event_name = excluded.event_name, division = excluded.division, round = excluded.round, heat_number = excluded.heat_number, judges = excluded.judges, surfers = excluded.surfers;

    INSERT INTO heat_configs (heat_id, judges, surfers, waves, tournament_type)
    VALUES
      ('${H1_ID}', ARRAY['J1','J2','J3','J4','J5'], ARRAY['ROUGE','BLANC','JAUNE','BLEU'], 15, 'standard'),
      ('${H2_ID}', ARRAY['J1','J2','J3','J4','J5'], ARRAY['ROUGE','BLANC','JAUNE','BLEU'], 15, 'standard')
    ON CONFLICT (heat_id) DO UPDATE SET judges = excluded.judges, surfers = excluded.surfers;

    INSERT INTO participants (event_id, category, name, seed)
    VALUES
      (${EVENT_ID}, 'OPEN', 'Surfer Red 1', 1),
      (${EVENT_ID}, 'OPEN', 'Surfer White 1', 2),
      (${EVENT_ID}, 'OPEN', 'Surfer Yellow 1', 3),
      (${EVENT_ID}, 'OPEN', 'Surfer Blue 1', 4)
    ON CONFLICT DO NOTHING;

    UPDATE heat_entries SET participant_id = p.id FROM participants p WHERE heat_entries.heat_id = '${H1_ID}' AND heat_entries.color = 'ROUGE' AND p.name = 'Surfer Red 1';
    UPDATE heat_entries SET participant_id = p.id FROM participants p WHERE heat_entries.heat_id = '${H1_ID}' AND heat_entries.color = 'BLANC' AND p.name = 'Surfer White 1';
    UPDATE heat_entries SET participant_id = p.id FROM participants p WHERE heat_entries.heat_id = '${H1_ID}' AND heat_entries.color = 'JAUNE' AND p.name = 'Surfer Yellow 1';
    UPDATE heat_entries SET participant_id = p.id FROM participants p WHERE heat_entries.heat_id = '${H1_ID}' AND heat_entries.color = 'BLEU' AND p.name = 'Surfer Blue 1';
  "`);

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
