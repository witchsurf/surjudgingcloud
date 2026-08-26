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

async function runGate3() {
  console.log('\n======================================================');
  console.log('🚀 GATE 3: RESTART POSTGREST (Resilience & Zero Duplication)');
  console.log('======================================================');

  // Setup initial DB state
  console.log('\n[SETUP] Initializing H1 as active heat on Podium A...');
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM scores WHERE heat_id = '${H1_ID}';"`);

  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "UPDATE public.heats SET status = 'open', is_active = true WHERE id = '${H1_ID}';"`);
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
      ('${H1_ID}', ${EVENT_ID}, 'J5', 'J5', 'Judge J5')
    ON CONFLICT DO NOTHING;

    INSERT INTO event_last_config (event_id, event_name, division, round, heat_number, judges, surfers)
    VALUES (${EVENT_ID}, 'P38-Test2-Disposable', 'OPEN', 1, 1, jsonb_build_array('J1','J2','J3','J4','J5'), ARRAY['ROUGE','BLANC','JAUNE','BLEU'])
    ON CONFLICT (event_id) DO UPDATE
    SET event_name = excluded.event_name, division = excluded.division, round = excluded.round, heat_number = excluded.heat_number, judges = excluded.judges, surfers = excluded.surfers;

    INSERT INTO heat_configs (heat_id, judges, surfers, waves, tournament_type)
    VALUES ('${H1_ID}', ARRAY['J1','J2','J3','J4','J5'], ARRAY['ROUGE','BLANC','JAUNE','BLEU'], 15, 'standard')
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

  // STEP 3: Perform mutation (submitting scores across judges on Wave 1 BLANC)
  console.log('[STEP 3] Performing mutation: submitting scores on Wave 1 BLANC...');
  for (const j of judges) {
    const { error } = await supabase.rpc('upsert_score_secure', {
      p_id: crypto.randomUUID(),
      p_heat_id: H1_ID,
      p_event_id: EVENT_ID,
      p_competition: 'P38-Test2-Disposable',
      p_division: 'OPEN',
      p_round: 1,
      p_judge_id: j,
      p_judge_name: `Judge ${j}`,
      p_judge_station: j,
      p_surfer: 'BLANC',
      p_wave_number: 1,
      p_score: 9.2
    });
    if (error) throw new Error(`upsert_score_secure failed for ${j}: ${error.message}`);
  }

  await pDisplay.waitForTimeout(3000);

  // STEP 4: Assert DB state and zero duplicates
  console.log('[STEP 4] Asserting DB state and zero duplication...');
  const { data: scores } = await supabase.from('scores').select('*').eq('heat_id', H1_ID);
  if (scores?.length !== 5) throw new Error(`Expected exactly 5 scores, got ${scores?.length}`);
  if (scores?.some((s) => s.score !== 9.2)) throw new Error('Expected all scores to be 9.2');
  console.log('  ✅ DB Check: exactly 5 scores (9.2) in DB');

  // STEP 5: Assert DOM propagation without manual page reload
  console.log('[STEP 5] Asserting DOM propagation on Display and Admin without reload...');
  let textDisplay = await pDisplay.innerText('body');
  let textAdmin = await pAdmin.innerText('body');
  if (!textDisplay.includes('9.2') && !textDisplay.includes('9,2')) {
    console.log('  Waiting 3s more for realtime sync...');
    await pDisplay.waitForTimeout(3000);
    textDisplay = await pDisplay.innerText('body');
    textAdmin = await pAdmin.innerText('body');
  }
  console.log('  Display text snippet:', textDisplay.slice(0, 300).replace(/\n/g, ' '));
  console.log('  Admin text snippet:', textAdmin.slice(0, 300).replace(/\n/g, ' '));
  const alertText = await pAdmin.locator('[data-admin-scoring-state]').allInnerTexts();
  console.log('  Admin scoring alert:', alertText);
  if (!textDisplay.includes('9.2') && !textDisplay.includes('9,2')) throw new Error('Display did not receive 9.2 score post-restart: ' + textDisplay);
  if (!textAdmin.includes('9.2') && !textAdmin.includes('9,2')) throw new Error('Admin did not receive 9.2 score post-restart: ' + textAdmin);
  console.log('  ✅ DOM Check: Display and Admin rendered 9.2 score automatically');

  await browser.close();
  console.log('\n🎉 GATE 3 (RESTART POSTGREST): 100% PASS!\n');
}

runGate3().catch((err) => {
  console.error('❌ GATE 3 FAILED:', err);
  process.exit(1);
});
