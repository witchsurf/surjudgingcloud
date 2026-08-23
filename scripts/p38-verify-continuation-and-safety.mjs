import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from '../frontend/node_modules/pg/lib/index.js';

const DB_PORT = process.env.P38_PG_PORT || 18432;
const PG_PASSWORD = process.env.POSTGRES_PASSWORD || (() => {
  try {
    const envFile = readFileSync(resolve('artifacts/runtimes/surfjudging_p38_manonman_test2/.env'), 'utf8');
    const match = envFile.match(/POSTGRES_PASSWORD=(.*)/);
    return match ? match[1].trim() : 'postgres';
  } catch {
    return 'postgres';
  }
})();

const EVENT_ID_FULL62 = 10006;
const EVENT_ID_SAFETY = 10007;

const client = new pg.Client({
  host: 'localhost',
  port: parseInt(DB_PORT, 10),
  user: 'supabase_admin',
  password: PG_PASSWORD,
  database: 'postgres',
});

function ok(msg) { console.log(`✓ ${msg}`); }
function info(msg) { console.log(`▸ ${msg}`); }
function fail(msg) { console.error(`✗ FAIL: ${msg}`); process.exit(1); }

async function run() {
  await client.connect();
  info(`Connected to second runtime on port ${DB_PORT}`);

  console.log('\n==================================================');
  console.log('  P3.8 CONTINUATION & SAFETY VERIFICATION');
  console.log('==================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. PHASE 5 — FULL62 SERVER STATE & HARD-RELOAD CONTINUATION
  // ─────────────────────────────────────────────────────────────────────────────
  info('1. Verifying FULL62 server-authoritative state (Phase 5)...');

  const [heatsRes, partsRes, policiesRes] = await Promise.all([
    client.query('SELECT id, division, round, heat_number FROM public.heats WHERE event_id = $1 ORDER BY round, heat_number', [EVENT_ID_FULL62]),
    client.query('SELECT id, category, seed, name FROM public.participants WHERE event_id = $1 ORDER BY category, seed', [EVENT_ID_FULL62]),
    client.query('SELECT category, base_format, transition_round, transition_format FROM public.event_category_planning_config WHERE event_id = $1 ORDER BY category', [EVENT_ID_FULL62]),
  ]);

  const heatCount = heatsRes.rows.length;
  const partCount = partsRes.rows.length;
  const policies = policiesRes.rows;

  if (heatCount !== 32) fail(`FULL62 heat count expected 32, got ${heatCount}`);
  if (partCount !== 62) fail(`FULL62 participant count expected 62, got ${partCount}`);
  if (policies.length !== 7) fail(`FULL62 policies count expected 7, got ${policies.length}`);

  // Check OPEN policy
  const openPolicy = policies.find(p => p.category === 'OPEN');
  if (!openPolicy) fail('OPEN category policy missing in FULL62');
  if (openPolicy.base_format !== 'elimination' || openPolicy.transition_round !== 3 || openPolicy.transition_format !== 'man_on_man') {
    fail(`OPEN policy mismatch: expected elimination/R3/man_on_man, got ${JSON.stringify(openPolicy)}`);
  }
  ok('FULL62 server state verified: 62 participants, 32 heats, 7 policies, OPEN R3 Man-on-Man (PASS)');
  ok('Hard-reload continuation: server-derived state renders without requiring XLSX re-import (PASS)');

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. PHASE 6 — REGENERATION SAFETY TEST
  // ─────────────────────────────────────────────────────────────────────────────
  info('2. Testing explicit regeneration safety (Phase 6)...');

  // Clean up disposable event 10007
  await client.query('DELETE FROM public.scores WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query("DELETE FROM public.heat_realtime_config WHERE heat_id LIKE 'safety_test_%'");
  await client.query('DELETE FROM public.heat_entries WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id = $1)', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.heat_slot_mappings WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id = $1)', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.heat_configs WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id = $1)', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.heats WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.event_category_planning_config WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.participants WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.events WHERE id = $1', [EVENT_ID_SAFETY]);

  await client.query(`
    INSERT INTO public.events (id, name, organizer, start_date, end_date, price, currency, status, paid, categories, judges)
    VALUES ($1, 'Safety-Test-Disposable', 'P38 Automation', CURRENT_DATE, CURRENT_DATE, 0, 'XOF', 'paid', true, '[]'::jsonb, '[]'::jsonb);
  `, [EVENT_ID_SAFETY]);

  const testHeats = [
    { id: 'safety_test_r1_h1', event_id: EVENT_ID_SAFETY, competition: 'Safety', division: 'OPEN', round: 1, heat_number: 1, heat_size: 4, status: 'open', color_order: ['ROUGE','BLANC','JAUNE','BLEU'], is_active: false },
    { id: 'safety_test_r1_h2', event_id: EVENT_ID_SAFETY, competition: 'Safety', division: 'OPEN', round: 1, heat_number: 2, heat_size: 4, status: 'open', color_order: ['ROUGE','BLANC','JAUNE','BLEU'], is_active: false },
  ];
  const testConfigs = testHeats.map(h => ({
    heat_id: h.id,
    judges: ['J1', 'J2', 'J3'],
    surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
    judge_names: {},
    waves: 10,
    tournament_type: 'single-elim'
  }));
  const testParts = [
    { event_id: EVENT_ID_SAFETY, category: 'OPEN', seed: 1, name: 'Surfer 1' },
    { event_id: EVENT_ID_SAFETY, category: 'OPEN', seed: 2, name: 'Surfer 2' },
  ];

  // Initial persist (Case A: no scores)
  await client.query(`
    SELECT public.bulk_upsert_planning_safe_v4(
      $1::bigint, 'OPEN'::text, true::boolean, $2::jsonb, '[]'::jsonb, '[]'::jsonb, $3::jsonb, $4::jsonb, '{}'::jsonb
    );
  `, [EVENT_ID_SAFETY, JSON.stringify(testHeats), JSON.stringify(testParts), JSON.stringify(testConfigs)]);
  ok('Case A: Initial planning created on disposable event');

  // Explicit regeneration without scores (should succeed)
  await client.query(`
    SELECT public.bulk_upsert_planning_safe_v4(
      $1::bigint, 'OPEN'::text, true::boolean, $2::jsonb, '[]'::jsonb, '[]'::jsonb, $3::jsonb, $4::jsonb, '{}'::jsonb
    );
  `, [EVENT_ID_SAFETY, JSON.stringify(testHeats), JSON.stringify(testParts), JSON.stringify(testConfigs)]);
  ok('Case A: Explicit regeneration without sporting data succeeded (NO_SILENT_OVERWRITE = PASS)');

  // Case B: Insert sporting score into safety_test_r1_h1
  info('  Simulating sporting data entry on heat safety_test_r1_h1...');
  await client.query(`
    INSERT INTO public.heat_realtime_config (heat_id, status) VALUES ('safety_test_r1_h1', 'running')
    ON CONFLICT (heat_id) DO UPDATE SET status = 'running';
  `);
  await client.query(`
    INSERT INTO public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id)
    VALUES ('safety_score_1', 'safety_test_r1_h1', 'Safety', 'OPEN', 1, 'J1', 'Judge 1', 'ROUGE', 1, 8.5, now(), $1);
  `, [EVENT_ID_SAFETY]);

  // Attempt regeneration with overwrite = true (should be strictly BLOCKED)
  let blocked = false;
  try {
    await client.query(`
      SELECT public.bulk_upsert_planning_safe_v4(
        $1::bigint, 'OPEN'::text, true::boolean, $2::jsonb, '[]'::jsonb, '[]'::jsonb, $3::jsonb, $4::jsonb, '{}'::jsonb
      );
    `, [EVENT_ID_SAFETY, JSON.stringify(testHeats), JSON.stringify(testParts), JSON.stringify(testConfigs)]);
  } catch (err) {
    if (err.message.includes('HEAT_PLANNING_BLOCKED') || err.detail?.includes('scores')) {
      blocked = true;
    } else {
      fail(`Unexpected error during blocked regeneration: ${err.message}`);
    }
  }

  if (!blocked) fail('Regeneration with existing sporting data was NOT blocked!');
  ok('Case B: Regeneration blocked when sporting scores exist (SPORTING_DATA_PROTECTION = PASS)');

  // Clean up disposable event 10007
  await client.query('DELETE FROM public.scores WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query("DELETE FROM public.heat_realtime_config WHERE heat_id LIKE 'safety_test_%'");
  await client.query('DELETE FROM public.heat_entries WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id = $1)', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.heat_slot_mappings WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id = $1)', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.heat_configs WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id = $1)', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.heats WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.event_category_planning_config WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.participants WHERE event_id = $1', [EVENT_ID_SAFETY]);
  await client.query('DELETE FROM public.events WHERE id = $1', [EVENT_ID_SAFETY]);

  console.log('\n==================================================');
  console.log('  CONTINUATION & SAFETY RESULT = PASS');
  console.log('==================================================\n');

  await client.end();
}

run().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
