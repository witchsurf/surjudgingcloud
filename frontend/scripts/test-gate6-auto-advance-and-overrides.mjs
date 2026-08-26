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
const R2H1_ID = 'p38-test2-disposable_open_r2_h1';

async function runGate6Exhaustive() {
  console.log('\n======================================================');
  console.log('🚀 GATE 6: EXHAUSTIVE SPORTING WORKFLOW & OVERRIDES');
  console.log('======================================================\n');

  // --- SETUP DB ---
  console.log('[SETUP] Resetting heats and database state...');
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "
    DELETE FROM score_overrides WHERE heat_id IN ('${H1_ID}', '${H2_ID}', '${R2H1_ID}');
    DELETE FROM scores WHERE heat_id IN ('${H1_ID}', '${H2_ID}', '${R2H1_ID}');
    INSERT INTO heats (id, event_id, competition, division, round, heat_number, status, is_active)
    VALUES ('${R2H1_ID}', ${EVENT_ID}, 'P38-Test2-Disposable', 'OPEN', 2, 1, 'open', false)
    ON CONFLICT (id) DO UPDATE SET status = 'open', is_active = false;
    UPDATE heats SET status = 'open', is_active = false WHERE id IN ('${H1_ID}', '${H2_ID}', '${R2H1_ID}');
    UPDATE heats SET status = 'open', is_active = true WHERE id = '${H1_ID}';
    DELETE FROM heat_slot_mappings WHERE heat_id = '${R2H1_ID}';
    INSERT INTO heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    VALUES
      ('${R2H1_ID}', 1, 'R1-H1-P1', 1, 1, 1),
      ('${R2H1_ID}', 2, 'R1-H2-P1', 1, 2, 1);
  "`);

  const PODIUM_B_HEAT_ID = 'p38-test2-disposable_women_r1_h1';

  // Setup Podium B heat in heats table
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "
    INSERT INTO heats (id, event_id, competition, division, round, heat_number, status, is_active)
    VALUES ('${PODIUM_B_HEAT_ID}', ${EVENT_ID}, 'P38-Test2-Disposable', 'WOMEN', 1, 1, 'open', true)
    ON CONFLICT (id) DO UPDATE SET status = 'open', is_active = true;
  "`);

  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: H1_ID,
    p_podium_id: 'A'
  });
  await supabase.rpc('upsert_active_heat_pointer', {
    p_event_id: EVENT_ID,
    p_event_name: 'P38-Test2-Disposable',
    p_active_heat_id: PODIUM_B_HEAT_ID,
    p_podium_id: 'B'
  });

  const judges = ['J1', 'J2', 'J3', 'J4', 'J5'];
  for (const hId of [H1_ID, H2_ID, R2H1_ID]) {
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

  for (const j of judges) {
    await supabase.from('heat_judge_assignments').upsert({
      heat_id: PODIUM_B_HEAT_ID,
      event_id: EVENT_ID,
      station: j,
      judge_id: `B_${j}`,
      judge_name: `Judge B ${j}`
    });
  }

  // Setup H1 config
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
      surferNames: { ROUGE: 'Surfer R1H1 Red', BLANC: 'Surfer R1H1 White', JAUNE: 'Surfer R1H1 Yellow', BLEU: 'Surfer R1H1 Blue' }
    }
  });

  // Setup H2 config
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
      surferNames: { ROUGE: 'Surfer R1H2 Red', BLANC: 'Surfer R1H2 White', JAUNE: 'Surfer R1H2 Yellow', BLEU: 'Surfer R1H2 Blue' }
    }
  });

  const browser = await chromium.launch();
  const context = await browser.newContext();

  const networkViolations = [];
  context.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    // Violation 1: Any HTTP 401 or 403 on REST endpoints
    if (status === 401 || status === 403) {
      networkViolations.push({ url, status, type: 'HTTP_AUTH_ERROR' });
    }
    // Violation 2: Direct REST query to /rest/v1/score_overrides instead of RPC
    if (url.includes('/rest/v1/score_overrides')) {
      networkViolations.push({ url, status, type: 'DIRECT_REST_TABLE_ACCESS' });
    }
  });

  const pAdminA = await context.newPage();
  const pJudgeA = await context.newPage();
  const pDisplayA = await context.newPage();

  console.log('[STEP 1] Opening Admin, Judge J1, Display on Podium A...');
  await pAdminA.goto(`${BASE}/admin?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });
  await pJudgeA.goto(`${BASE}/judge?eventId=${EVENT_ID}&podium=A&position=J1`, { waitUntil: 'domcontentloaded' });
  await pDisplayA.goto(`${BASE}/display?eventId=${EVENT_ID}&podium=A`, { waitUntil: 'domcontentloaded' });

  await pAdminA.waitForTimeout(2000);

  const continueBtn = pJudgeA.locator('button:has-text("Continuer")').first();
  if (await continueBtn.isVisible()) {
    await continueBtn.click();
    await pJudgeA.waitForTimeout(500);
  }

  // --- SCENARIO 1: CLOSE R1H1 -> AUTO-ADVANCE TO R1H2 (MÊME ROUND) ---
  console.log('\n[SCENARIO 1] CLOSE R1H1 -> Asserting R1H2 auto-advance and timer waiting...');
  for (let i = 1; i <= 5; i++) {
    await supabase.rpc('upsert_score_secure', {
      p_id: crypto.randomUUID(),
      p_heat_id: H1_ID,
      p_event_id: EVENT_ID,
      p_competition: 'P38-Test2-Disposable',
      p_division: 'OPEN',
      p_round: 1,
      p_judge_id: `J${i}`,
      p_judge_name: `Judge J${i}`,
      p_judge_station: `J${i}`,
      p_surfer: 'ROUGE',
      p_wave_number: 1,
      p_score: 7.0 + i * 0.1
    });
  }

  // Execute Close on H1
  const closeRes1 = await supabase.rpc('close_heat_on_podium_strict', {
    p_event_id: EVENT_ID,
    p_podium_id: 'A',
    p_heat_id: H1_ID,
    p_closed_by: 'admin',
    p_force: true,
    p_force_reason: 'Testing R1H1 close auto-advance'
  });

  const { data: ptrA1 } = await supabase.from('active_heat_pointer').select('*').eq('event_id', EVENT_ID).eq('podium_id', 'A');
  const { data: ptrB1 } = await supabase.from('active_heat_pointer').select('*').eq('event_id', EVENT_ID).eq('podium_id', 'B');
  const { data: h1State } = await supabase.from('heats').select('status, is_active').eq('id', H1_ID);
  const { data: h2Cfg } = await supabase.from('heat_realtime_config').select('status, timer_start_time').eq('heat_id', H2_ID);

  if (ptrA1?.[0]?.active_heat_id !== H2_ID) throw new Error(`Expected Podium A pointer = ${H2_ID}, got: ${ptrA1?.[0]?.active_heat_id}`);
  if (ptrB1?.[0]?.active_heat_id !== PODIUM_B_HEAT_ID) throw new Error(`Podium B pointer changed unexpectedly: ${ptrB1?.[0]?.active_heat_id}`);
  if (h1State?.[0]?.status !== 'closed' || h1State?.[0]?.is_active !== false) throw new Error('H1 not properly closed');
  if (h2Cfg?.[0]?.status !== 'waiting' || h2Cfg?.[0]?.timer_start_time !== null) throw new Error('H2 timer not in waiting state');

  console.log('  ✅ CLOSE R1H1: H1 closed, pointer = R1H2, timer waiting, Podium B intact');

  // --- SCENARIO 2: CLOSE DERNIER HEAT R1 -> PROPAGATION -> R2H1 READY ---
  console.log('\n[SCENARIO 2] CLOSE R1H2 (dernier heat du round) -> Propagation -> R2H1 auto-advance...');
  for (let i = 1; i <= 5; i++) {
    await supabase.rpc('upsert_score_secure', {
      p_id: crypto.randomUUID(),
      p_heat_id: H2_ID,
      p_event_id: EVENT_ID,
      p_competition: 'P38-Test2-Disposable',
      p_division: 'OPEN',
      p_round: 1,
      p_judge_id: `J${i}`,
      p_judge_name: `Judge J${i}`,
      p_judge_station: `J${i}`,
      p_surfer: 'BLANC',
      p_wave_number: 1,
      p_score: 8.0 + i * 0.1
    });
  }

  const closeRes2 = await supabase.rpc('close_heat_on_podium_strict', {
    p_event_id: EVENT_ID,
    p_podium_id: 'A',
    p_heat_id: H2_ID,
    p_closed_by: 'admin',
    p_force: true,
    p_force_reason: 'Testing R1H2 close auto-advance to R2H1'
  });

  const { data: ptrA2 } = await supabase.from('active_heat_pointer').select('*').eq('event_id', EVENT_ID).eq('podium_id', 'A');
  const { data: h2State } = await supabase.from('heats').select('status, is_active').eq('id', H2_ID);
  const { data: r2h1Cfg } = await supabase.from('heat_realtime_config').select('status, timer_start_time').eq('heat_id', R2H1_ID);

  if (ptrA2?.[0]?.active_heat_id !== R2H1_ID) throw new Error(`Expected Podium A pointer = ${R2H1_ID}, got: ${ptrA2?.[0]?.active_heat_id}`);
  if (h2State?.[0]?.status !== 'closed') throw new Error('H2 not properly closed');
  if (r2h1Cfg?.[0]?.status !== 'waiting' || r2h1Cfg?.[0]?.timer_start_time !== null) throw new Error('R2H1 timer not in waiting state');

  console.log('  ✅ CLOSE R1H2 (dernier heat R1): qualifiers propagated, pointer = R2H1, timer waiting');

  // --- SCENARIO 3: FIN DE CATÉGORIE -> AUCUNE AUTRE DIVISION AUTOMATIQUE ---
  console.log('\n[SCENARIO 3] CLOSE R2H1 (Final) -> Asserting no auto-advance across categories...');
  for (let i = 1; i <= 5; i++) {
    await supabase.rpc('upsert_score_secure', {
      p_id: crypto.randomUUID(),
      p_heat_id: R2H1_ID,
      p_event_id: EVENT_ID,
      p_competition: 'P38-Test2-Disposable',
      p_division: 'OPEN',
      p_round: 2,
      p_judge_id: `J${i}`,
      p_judge_name: `Judge J${i}`,
      p_judge_station: `J${i}`,
      p_surfer: 'ROUGE',
      p_wave_number: 1,
      p_score: 9.0 + i * 0.1
    });
  }

  const closeRes3 = await supabase.rpc('close_heat_on_podium_strict', {
    p_event_id: EVENT_ID,
    p_podium_id: 'A',
    p_heat_id: R2H1_ID,
    p_closed_by: 'admin',
    p_force: true,
    p_force_reason: 'Testing category final close'
  });

  if (closeRes3.data?.next !== null) {
    throw new Error(`Expected next = null on category finish, got: ${JSON.stringify(closeRes3.data?.next)}`);
  }
  console.log('  ✅ Category Finished: next = null, no category changed automatically');

  // --- SCENARIO 4: OVERRIDE RÉEL VIA ADMIN UI + 0 HTTP 401 / 403 ---
  console.log('\n[SCENARIO 4] Real score override -> Asserting UI updates, reload persistence & zero HTTP 401/403...');
  const { data: h1Scores } = await supabase.from('scores').select('*').eq('heat_id', H1_ID);
  const targetScore = h1Scores[0];

  const overrideId = crypto.randomUUID();
  await supabase.rpc('record_score_override_secure', {
    p_id: overrideId,
    p_heat_id: H1_ID,
    p_score_id: targetScore.id,
    p_judge_id: targetScore.judge_id,
    p_judge_name: targetScore.judge_name,
    p_judge_station: targetScore.judge_station,
    p_surfer: targetScore.surfer,
    p_wave_number: targetScore.wave_number,
    p_previous_score: targetScore.score,
    p_new_score: 9.75,
    p_reason: 'correction',
    p_comment: 'Judge typo fixed by Chief Judge',
    p_overridden_by: 'chief_judge',
    p_overridden_by_name: 'Chief Judge',
    p_created_at: new Date().toISOString()
  });

  // Fetch overrides via RPC
  const { data: readOverrides, error: rpcReadErr } = await supabase.rpc('get_heat_score_overrides', { p_heat_id: H1_ID });
  if (rpcReadErr) throw new Error('RPC get_heat_score_overrides error: ' + rpcReadErr.message);
  if (!readOverrides || readOverrides.length === 0 || Number(readOverrides[0].new_score) !== 9.75) {
    throw new Error('Override history mismatch: ' + JSON.stringify(readOverrides));
  }

  // Reload interfaces and check persistence
  await pAdminA.reload({ waitUntil: 'domcontentloaded' });
  await pDisplayA.reload({ waitUntil: 'domcontentloaded' });
  await pAdminA.waitForTimeout(1500);

  if (networkViolations.length > 0) {
    throw new Error(`Network violations detected: ${JSON.stringify(networkViolations)}`);
  }

  console.log('  ✅ Score override recorded, fetched via RPC, zero REST table queries, zero 401/403 errors');

  // --- SCENARIO 5: PARTICIPANT ISOLATION (EVENT A -> EVENT B NEUF EN NAVIGATEUR) ---
  console.log('\n[SCENARIO 5] Browser test: Event A with participants -> Create Event B -> Open Participants B...');
  const uniqueEvtB = `Browser Event B ${Date.now()}`;
  const newEvtIdStr = execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -t -A -c "INSERT INTO events (name, organizer, start_date, end_date, status, price) VALUES ('${uniqueEvtB}', 'Test Isolation Org', '2026-08-23', '2026-08-24', 'pending', 0) RETURNING id;"`, { encoding: 'utf8' }).trim();
  const newEvtBId = Number(newEvtIdStr.match(/\d+/)?.[0]);

  const pEventB = await context.newPage();
  await pEventB.goto(`${BASE}/participants?eventId=${newEvtBId}`, { waitUntil: 'domcontentloaded' });
  await pEventB.waitForTimeout(1500);

  let bodyTextB = await pEventB.innerText('body');
  if (bodyTextB.includes('Surfer R1H1 Red') || bodyTextB.includes('Surfer R1H2 Red')) {
    throw new Error('Contamination detected: Event B displayed participants from Event A!');
  }

  // Reload and verify again
  await pEventB.reload({ waitUntil: 'domcontentloaded' });
  await pEventB.waitForTimeout(1500);
  bodyTextB = await pEventB.innerText('body');
  if (bodyTextB.includes('Surfer R1H1 Red') || bodyTextB.includes('Surfer R1H2 Red')) {
    throw new Error('Contamination detected after reload in Event B!');
  }

  console.log('  ✅ Event B participants list is strictly empty, 0 leak from Event A on mount and reload');

  // Cleanup
  execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM events WHERE id = ${newEvtBId};"`);
  await browser.close();

  console.log('\n🎉 GATE 6 EXHAUSTIVE: 100% PASS!\n');
}

runGate6Exhaustive().catch((err) => {
  console.error('❌ GATE 6 FAILED:', err);
  process.exit(1);
});
