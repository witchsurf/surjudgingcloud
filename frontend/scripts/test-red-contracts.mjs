import { parseEnvFile } from '../../scripts/build-field-runtime.mjs';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const env = parseEnvFile('../artifacts/runtimes/surfjudging_p38_manonman_test2/.env');
const anonKey = env.ANON_KEY;
const supabase = createClient('http://localhost:18400', anonKey);

const EVENT_ID = 10004;
const H1_ID = 'p38-test2-disposable_open_r1_h1';
const H2_ID = 'p38-test2-disposable_open_r1_h2';
const R2H1_ID = 'p38-test2-disposable_open_r2_h1';

async function runRedContractTests() {
  console.log('\n======================================================');
  console.log('🔴 RUNNING RED CONTRACT TESTS (Expected to FAIL before fix)');
  console.log('======================================================\n');

  let failCount = 0;
  let passCount = 0;

  // Test 1: CLOSE R1H1 -> pointer R1H2
  try {
    console.log('[TEST 1] Testing: CLOSE R1H1 -> pointer R1H2...');
    // Reset H1 & H2
    await supabase.from('heats').update({ status: 'open', is_active: true }).eq('id', H1_ID);
    await supabase.from('heats').update({ status: 'open', is_active: false }).eq('id', H2_ID);
    await supabase.rpc('upsert_active_heat_pointer', {
      p_event_id: EVENT_ID,
      p_event_name: 'P38-Test2-Disposable',
      p_active_heat_id: H1_ID,
      p_podium_id: 'A'
    });

    const res = await supabase.rpc('close_heat_on_podium_strict', {
      p_event_id: EVENT_ID,
      p_podium_id: 'A',
      p_heat_id: H1_ID,
      p_closed_by: 'admin',
      p_force: true,
      p_force_reason: 'Testing auto-advance'
    });

    const { data: ptr } = await supabase.from('active_heat_pointer').select('*').eq('event_id', EVENT_ID).eq('podium_id', 'A');
    if (ptr?.[0]?.active_heat_id !== H2_ID) {
      throw new Error(`Expected active_heat_pointer to be ${H2_ID}, but got: ${ptr?.[0]?.active_heat_id}`);
    }
    console.log('  ✅ TEST 1 PASS');
    passCount++;
  } catch (err) {
    console.log('  ❌ TEST 1 FAILED (Expected Red):', err.message);
    failCount++;
  }

  // Test 2: H2 activé mais timer waiting, timer_start_time = null
  try {
    console.log('\n[TEST 2] Testing: H2 activated with status waiting and timer_start_time = null...');
    const { data: cfg } = await supabase.from('heat_realtime_config').select('*').eq('heat_id', H2_ID);
    if (!cfg || cfg.length === 0) throw new Error('No realtime config found for H2');
    if (cfg[0].status !== 'waiting') throw new Error(`Expected H2 status waiting, got ${cfg[0].status}`);
    if (cfg[0].timer_start_time !== null) throw new Error(`Expected timer_start_time null, got ${cfg[0].timer_start_time}`);
    console.log('  ✅ TEST 2 PASS');
    passCount++;
  } catch (err) {
    console.log('  ❌ TEST 2 FAILED (Expected Red):', err.message);
    failCount++;
  }

  // Test 3: score_overrides read without 401 via secure RPC
  try {
    console.log('\n[TEST 3] Testing: score_overrides read via secure RPC (0 HTTP 401)...');
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_heat_score_overrides', {
      p_heat_id: H1_ID
    });
    if (rpcErr) throw rpcErr;
    console.log('  ✅ TEST 3 PASS');
    passCount++;
  } catch (err) {
    console.log('  ❌ TEST 3 FAILED (Expected Red):', err.message);
    failCount++;
  }

  // Test 4: Event B neuf sans import -> participants = []
  try {
    console.log('\n[TEST 4] Testing: Event B neuf -> participants list strictly empty...');
    // Create new event in DB via psql
    const uniqueName = `Event B Empty Test ${Date.now()}`;
    const newEvtIdStr = execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -t -A -c "INSERT INTO events (name, organizer, start_date, end_date, status, price) VALUES ('${uniqueName}', 'Test Org', '2026-08-23', '2026-08-24', 'pending', 0) RETURNING id;"`, { encoding: 'utf8' }).trim();
    const newEvtIdMatch = newEvtIdStr.match(/\d+/);
    const newEvtId = newEvtIdMatch ? Number(newEvtIdMatch[0]) : 0;

    const { data: parts, error: partErr } = await supabase.from('participants').select('*').eq('event_id', newEvtId);
    if (partErr) throw partErr;
    if (parts && parts.length > 0) throw new Error(`Expected 0 participants, found ${parts.length}`);
    
    // Clean up test event
    execSync(`docker exec surfjudging_p38_manonman_test2_postgres psql -U postgres -d postgres -c "DELETE FROM events WHERE id = ${newEvtId};"`);
    console.log('  ✅ TEST 4 PASS');
    passCount++;
  } catch (err) {
    console.log('  ❌ TEST 4 FAILED:', err.message);
    failCount++;
  }

  console.log(`\nRED TESTS SUMMARY: ${failCount} failed as expected on current code, ${passCount} passed.`);
}

runRedContractTests().catch(console.error);
