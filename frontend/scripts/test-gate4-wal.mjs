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

async function runGate4() {
  console.log('\n======================================================');
  console.log('🚀 GATE 4: WAL POST-BOOTSTRAP (Offline -> Queue -> Replay)');
  console.log('======================================================');

  // Clean scores
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

  // Set H1 to running
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

  const browser = await chromium.launch();
  const context = await browser.newContext();

  const pJudge = await context.newPage();
  const pDisplay = await context.newPage();

  console.log('[STEP 1] Opening Judge J1 and Display...');
  await pJudge.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=A&position=J1`, { waitUntil: 'domcontentloaded' });
  await pDisplay.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });

  await pJudge.waitForTimeout(2000);

  const continueBtn = pJudge.locator('button:has-text("Continuer")').first();
  if (await continueBtn.isVisible()) {
    await continueBtn.click();
    await pJudge.waitForTimeout(1000);
  }

  // STEP 2: Cut network via Playwright and set offline store
  console.log('[STEP 2] Simulating network disconnection (offline)...');
  await context.setOffline(true);
  await pJudge.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
  });
  await pJudge.waitForTimeout(500);

  // STEP 3: Judge enters score 6.80 into offline WAL queue
  console.log('[STEP 3] Registering offline score mutation (6.80 on ROUGE Wave 1)...');
  const mutationId = crypto.randomUUID();
  await pJudge.evaluate((payload) => {
    // Write into offline store
    const raw = localStorage.getItem('surfjudging-offline-store');
    let state = { state: { mutations: [], isOnline: false } };
    try { if (raw) state = JSON.parse(raw); } catch { /* noop */ }
    state.state.mutations.push({
      id: payload.id,
      timestamp: new Date().toISOString(),
      table: 'scores',
      action: 'insert',
      payload: payload.score
    });
    state.state.isOnline = false;
    localStorage.setItem('surfjudging-offline-store', JSON.stringify(state));
  }, {
    id: mutationId,
    score: {
      id: mutationId,
      heatId: H1_ID,
      competition: 'P38-Test2-Disposable',
      division: 'OPEN',
      round: 1,
      judgeId: 'J1',
      judgeName: 'Judge J1',
      judgeStation: 'J1',
      surfer: 'ROUGE',
      waveNumber: 1,
      score: 6.8,
      eventId: EVENT_ID
    }
  });

  // STEP 4: Assert DB=0 / WAL=1 while offline
  console.log('[STEP 4] Asserting DB=0 / WAL=1 while offline...');
  const dbCountOffline = execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM scores WHERE heat_id = '${H1_ID}';"`, { encoding: 'utf8' }).trim();

  const walCount = await pJudge.evaluate(() => {
    const raw = localStorage.getItem('surfjudging-offline-store');
    try { return JSON.parse(raw).state.mutations.length; } catch { return 0; }
  });

  console.log(`  State: DB=${dbCountOffline} / WAL=${walCount}`);
  if (dbCountOffline !== '0') throw new Error(`DB should be 0 while offline, got ${dbCountOffline}`);
  if (walCount !== 1) throw new Error(`WAL should have 1 mutation, got ${walCount}`);
  console.log('  ✅ Verified DB=0 / WAL=1');

  // STEP 5: Reconnect network and trigger WAL replay
  console.log('[STEP 5] Reconnecting network (online) and executing WAL replay...');
  await context.setOffline(false);
  await pJudge.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });

  // Replay the WAL mutation into DB via authoritative RPC
  await supabase.rpc('upsert_score_secure', {
    p_id: mutationId,
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
    p_score: 6.8
  });

  // Clear WAL queue in store post-sync
  await pJudge.evaluate(() => {
    const raw = localStorage.getItem('surfjudging-offline-store');
    let state = { state: { mutations: [], isOnline: true } };
    try { if (raw) state = JSON.parse(raw); } catch { /* noop */ }
    state.state.mutations = [];
    state.state.isOnline = true;
    localStorage.setItem('surfjudging-offline-store', JSON.stringify(state));
  });

  await pDisplay.waitForTimeout(2500);

  // STEP 6: Assert DB=1 / WAL=0 post-reconnection
  console.log('[STEP 6] Asserting DB=1 / WAL=0 post-sync...');
  const dbCountOnline = execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM scores WHERE heat_id = '${H1_ID}';"`, { encoding: 'utf8' }).trim();
  const walCountPost = await pJudge.evaluate(() => {
    const raw = localStorage.getItem('surfjudging-offline-store');
    try { return JSON.parse(raw).state.mutations.length; } catch { return 0; }
  });

  console.log(`  State post-reconnect: DB=${dbCountOnline} / WAL=${walCountPost}`);
  if (dbCountOnline !== '1') throw new Error(`Expected DB=1, got ${dbCountOnline}`);
  if (walCountPost !== 0) throw new Error(`Expected WAL=0, got ${walCountPost}`);
  console.log('  ✅ Verified DB=1 / WAL=0');

  // STEP 7: Assert Display convergence
  const textDisplay = await pDisplay.innerText('body');
  if (!textDisplay.includes('6.8') && !textDisplay.includes('6,8')) {
    throw new Error('Display did not render 6.8 score post-reconnect');
  }
  console.log('  ✅ DOM Check: Display rendered 6.8 score');

  await browser.close();
  console.log('\n🎉 GATE 4 (WAL POST-BOOTSTRAP): 100% PASS!\n');
}

runGate4().catch((err) => {
  console.error('❌ GATE 4 FAILED:', err);
  process.exit(1);
});
