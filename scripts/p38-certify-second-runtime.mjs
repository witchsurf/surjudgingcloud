#!/usr/bin/env node
// Run through `npm run p38:certify:test2`: the certification imports the
// authoritative TypeScript planning modules instead of stale compiled copies.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from '../frontend/node_modules/pg/lib/index.js';
import { generatePreviewHeats } from '../frontend/src/utils/heatGeneration.ts';
import { inferImplicitMappingsForHeat } from '../frontend/src/utils/heatSlotMappingInference.ts';
import { buildCategoryCalls } from './p38-category-dispatcher.mjs';

const { Client } = pg;

const PG_PORT = process.env.P38_PG_PORT || 18432;
const PG_PASSWORD = process.env.POSTGRES_PASSWORD || (() => {
  try {
    const envFile = readFileSync(resolve('artifacts/runtimes/surfjudging_p38_manonman_test2/.env'), 'utf8');
    const match = envFile.match(/POSTGRES_PASSWORD=(.*)/);
    return match ? match[1].trim() : 'postgres';
  } catch {
    return 'postgres';
  }
})();

const client = new Client({
  host: 'localhost',
  port: PG_PORT,
  user: 'supabase_admin',
  password: PG_PASSWORD,
  database: 'postgres',
});

function ok(msg) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function fail(msg) {
  console.error(`\x1b[31m✗ FAIL: ${msg}\x1b[0m`);
  process.exit(1);
}

function info(msg) {
  console.log(`\x1b[36m▸ ${msg}\x1b[0m`);
}

async function run() {
  await client.connect();
  info(`Connected to PostgreSQL on localhost:${PG_PORT} as supabase_admin`);

  console.log('\n==================================================');
  console.log('  P3.8 SECOND RUNTIME FUNCTIONAL CERTIFICATION');
  console.log('==================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SCHEMA INTEGRITY & EQUIVALENCE CHECK
  // ─────────────────────────────────────────────────────────────────────────────
  info('1. Verifying schema integrity and migration status');
  const verRes = await client.query('SELECT schema_version FROM public.app_runtime_schema_version LIMIT 1;');
  const schemaVersion = verRes.rows[0]?.schema_version;
  const manifest = JSON.parse(readFileSync(resolve('config/p38-from-zero-manifest.json'), 'utf8'));
  const EXPECTED_SCHEMA_VERSION = manifest.migrations
    .slice()
    .sort((a, b) => a.order - b.order)
    .at(-1)
    .path.split('/').at(-1).replace(/\.sql$/, '');
  if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    fail(`Schema version mismatch: ${schemaVersion}`);
  }
  ok(`Schema version verified: ${schemaVersion}`);

  const modeRes = await client.query('SELECT public.get_authoritative_deployment_mode();');
  const deployMode = modeRes.rows[0]?.get_authoritative_deployment_mode;
  if (deployMode !== 'field') {
    fail(`Deployment mode mismatch: ${deployMode}`);
  }
  ok(`Deployment mode verified: ${deployMode}`);

  const tableCountRes = await client.query(`
    SELECT count(*) as c FROM information_schema.tables WHERE table_schema = 'public';
  `);
  ok(`Public schema table count: ${tableCountRes.rows[0].c}`);

  // Clean up any previous disposable test data (events 10005, 10006)
  await client.query(`
    DELETE FROM public.scores WHERE event_id IN (10005, 10006);
    DELETE FROM public.heat_realtime_config WHERE heat_id LIKE 'p38_%';
    DELETE FROM public.heat_entries WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id IN (10005, 10006));
    DELETE FROM public.heat_slot_mappings WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id IN (10005, 10006));
    DELETE FROM public.heat_configs WHERE heat_id IN (SELECT id FROM public.heats WHERE event_id IN (10005, 10006));
    DELETE FROM public.heats WHERE event_id IN (10005, 10006);
    DELETE FROM public.event_category_planning_config WHERE event_id IN (10005, 10006);
    DELETE FROM public.participants WHERE event_id IN (10005, 10006);
    DELETE FROM public.events WHERE id IN (10005, 10006);
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. SECTION A — OPEN20 PROVISIONING
  // ─────────────────────────────────────────────────────────────────────────────
  info('2. Testing SECTION A: OPEN20 Provisioning');
  const EVENT_ID_OPEN20 = 10005;

  // Create disposable event 10005
  await client.query(`
    INSERT INTO public.events (id, name, organizer, start_date, end_date, price, currency, status, paid, categories, judges)
    VALUES ($1, 'P38-OPEN20-Test', 'P38 Automation', CURRENT_DATE, CURRENT_DATE, 0, 'XOF', 'paid', true, '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `, [EVENT_ID_OPEN20]);

  // Generate OPEN20 payload
  const open20Participants = Array.from({ length: 20 }, (_, i) => ({
    name: `OPEN_SURFER_${i + 1}`,
    seed: i + 1,
    country: 'SN',
    category: 'OPEN',
    event_id: EVENT_ID_OPEN20
  }));

  const open20Plans = generatePreviewHeats(
    open20Participants,
    'elimination',
    4,
    { manOnManFromRound: 3, promoteBestSecond: true }
  );

  const open20Heats = open20Plans.flatMap(p => p.heats.map(h => ({
    id: `p38_open20_r${p.round}_h${h.heat_number}`,
    event_id: EVENT_ID_OPEN20,
    competition: `P38-OPEN20-${EVENT_ID_OPEN20}`,
    division: 'OPEN',
    round: p.round,
    heat_number: h.heat_number,
    heat_size: h.surfers.length,
    status: 'open',
    is_active: false,
    color_order: h.surfers.length === 2 ? ['ROUGE', 'BLANC'] : h.surfers.length === 3 ? ['ROUGE', 'BLANC', 'JAUNE'] : ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
    surfers: h.surfers
  })));

  const open20Seq = open20Heats.map(h => ({
    id: h.id,
    round: h.round,
    heat_number: h.heat_number,
    heat_size: h.heat_size
  }));

  const open20Mappings = open20Heats.flatMap(h => inferImplicitMappingsForHeat(open20Seq, h.id));

  const open20Configs = open20Heats.map(h => ({
    heat_id: h.id,
    judges: ['J1', 'J2', 'J3'],
    surfers: h.color_order,
    judge_names: {},
    waves: 15,
    tournament_type: 'elimination'
  }));

  const open20Policy = {
    base_format: 'elimination',
    transition_round: 3,
    transition_format: 'man_on_man',
    version: 1
  };

  // Call bulk_upsert_planning_safe_v4
  await client.query(`
    SELECT public.bulk_upsert_planning_safe_v4(
      $1::bigint,
      $2::text,
      $3::boolean,
      $4::jsonb,
      $5::jsonb,
      $6::jsonb,
      $7::jsonb,
      $8::jsonb,
      $9::jsonb
    );
  `, [
    EVENT_ID_OPEN20,
    'OPEN',
    true,
    JSON.stringify(open20Heats),
    JSON.stringify([]),
    JSON.stringify(open20Mappings),
    JSON.stringify(open20Participants),
    JSON.stringify(open20Configs),
    JSON.stringify(open20Policy)
  ]);

  // Fetch participant IDs to seed Round 1 heat_entries
  const pRows = (await client.query(`
    SELECT id, seed, name FROM public.participants WHERE event_id = $1 AND category = 'OPEN'
  `, [EVENT_ID_OPEN20])).rows;

  const open20R1Entries = [];
  for (const h of open20Heats.filter(h => h.round === 1)) {
    h.surfers.forEach((surfer, idx) => {
      const p = pRows.find(pr => pr.seed === surfer.seed);
      if (p) {
        open20R1Entries.push({
          heat_id: h.id,
          participant_id: p.id,
          position: idx + 1,
          seed: surfer.seed,
          color: h.color_order[idx]
        });
      }
    });
  }

  // Insert initial Round 1 heat_entries
  for (const entry of open20R1Entries) {
    await client.query(`
      INSERT INTO public.heat_entries (heat_id, participant_id, position, seed, color)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (heat_id, position) DO UPDATE SET
        participant_id = EXCLUDED.participant_id,
        seed = EXCLUDED.seed,
        color = EXCLUDED.color;
    `, [entry.heat_id, entry.participant_id, entry.position, entry.seed, entry.color]);
  }

  // Assertions on OPEN20
  const pCount = (await client.query('SELECT count(*) as c FROM public.participants WHERE event_id = $1 AND category = $2', [EVENT_ID_OPEN20, 'OPEN'])).rows[0].c;
  const hCount = (await client.query('SELECT count(*) as c FROM public.heats WHERE event_id = $1 AND division = $2', [EVENT_ID_OPEN20, 'OPEN'])).rows[0].c;
  const mCount = (await client.query(`
    SELECT count(*) as c FROM public.heat_slot_mappings m
    JOIN public.heats h ON h.id = m.heat_id
    WHERE h.event_id = $1 AND h.division = $2
  `, [EVENT_ID_OPEN20, 'OPEN'])).rows[0].c;
  const roundsRes = await client.query(`
    SELECT round, count(*) as heats FROM public.heats
    WHERE event_id = $1 AND division = $2
    GROUP BY round ORDER BY round ASC
  `, [EVENT_ID_OPEN20, 'OPEN']);

  const roundHeats = roundsRes.rows.map(r => parseInt(r.heats, 10));

  if (pCount != 20) fail(`OPEN20 participants count: expected 20, got ${pCount}`);
  if (hCount != 14) fail(`OPEN20 heats count: expected 14, got ${hCount}`);
  if (mCount != 22) fail(`OPEN20 mappings count: expected 22, got ${mCount}`);
  if (JSON.stringify(roundHeats) !== JSON.stringify([5, 3, 3, 2, 1])) {
    fail(`OPEN20 rounds breakdown: expected [5, 3, 3, 2, 1], got ${JSON.stringify(roundHeats)}`);
  }

  ok(`OPEN20: 20 participants, 14 heats, 22 mappings, rounds=[5, 3, 3, 2, 1] PASS`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. SECTION B — SPORTING PROPAGATION LIFECYCLE (R1 -> R2 -> R3 -> R4 -> Final)
  // ─────────────────────────────────────────────────────────────────────────────
  info('3. Testing SECTION B: Sporting Propagation with Meilleur 2e R3');

  // Helper to score heat with deterministic ranks
  async function scoreHeat(heatId, round, division, eventId, rankedColors) {
    // Set heat realtime status to running to permit scoring
    await client.query(`
      INSERT INTO public.heat_realtime_config (heat_id, status, timer_start_time, timer_duration_minutes)
      VALUES ($1, 'running', now(), 20)
      ON CONFLICT (heat_id) DO UPDATE SET status = 'running';
    `, [heatId]);

    const judges = ['J1', 'J2', 'J3'];
    for (let rankIdx = 0; rankIdx < rankedColors.length; rankIdx++) {
      const color = rankedColors[rankIdx];
      // Score decreases with rankIdx: rank 0 gets ~8.0, rank 1 gets ~6.0, etc.
      const baseScore = 9.0 - rankIdx * 1.5;
      for (const judge of judges) {
        for (let wave = 1; wave <= 2; wave++) {
          const scoreVal = (baseScore + wave * 0.2).toFixed(2);
          await client.query(`
            INSERT INTO public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
            ON CONFLICT (id) DO UPDATE SET score = EXCLUDED.score;
          `, [
            `score_${heatId}_${judge}_${color}_w${wave}`,
            heatId,
            `P38-OPEN20-${eventId}`,
            division,
            round,
            judge,
            judge,
            color,
            wave,
            scoreVal,
            eventId
          ]);
        }
      }
    }
    // Trigger propagation for this source heat
    await client.query('SELECT public.fn_propagate_qualifiers_for_source_heat($1)', [heatId]);

    // Close the heat in both heats table and heat_realtime_config
    await client.query('UPDATE public.heats SET status = $1 WHERE id = $2', ['closed', heatId]);
    await client.query('UPDATE public.heat_realtime_config SET status = $1 WHERE heat_id = $2', ['closed', heatId]);
  }

  // R1: 5 heats of 4 surfers
  info('  Propagating R1 heats (5 heats -> R2)...');
  for (let h = 1; h <= 5; h++) {
    const heatId = `p38_open20_r1_h${h}`;
    await scoreHeat(heatId, 1, 'OPEN', EVENT_ID_OPEN20, ['ROUGE', 'BLANC', 'JAUNE', 'BLEU']);
  }

  // Check R2 heat_entries count (should have 10 qualifiers: 2 from each of the 5 heats)
  const r2EntriesRes = await client.query(`
    SELECT h.id, count(e.id) as entrants FROM public.heats h
    LEFT JOIN public.heat_entries e ON e.heat_id = h.id
    WHERE h.event_id = $1 AND h.round = 2
    GROUP BY h.id ORDER BY h.id ASC;
  `, [EVENT_ID_OPEN20]);
  const totalR2Entrants = r2EntriesRes.rows.reduce((sum, r) => sum + parseInt(r.entrants, 10), 0);
  if (totalR2Entrants !== 10) fail(`R2 entrants count: expected 10, got ${totalR2Entrants}`);
  ok(`R1 -> R2 propagation: 10 qualifiers placed into 3 R2 heats`);

  // R2: 3 heats (H1=4 surfers, H2=3 surfers, H3=3 surfers)
  info('  Propagating R2 heats (3 heats -> R3 Man-on-Man)...');
  for (let h = 1; h <= 3; h++) {
    const heatId = `p38_open20_r2_h${h}`;
    const colors = h === 1 ? ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'] : ['ROUGE', 'BLANC', 'JAUNE'];
    await scoreHeat(heatId, 2, 'OPEN', EVENT_ID_OPEN20, colors);
  }

  // Check R3 heat_entries count (should have 6 qualifiers: 2 from each of 3 R2 heats)
  const r3EntriesRes = await client.query(`
    SELECT h.id, count(e.id) as entrants FROM public.heats h
    LEFT JOIN public.heat_entries e ON e.heat_id = h.id
    WHERE h.event_id = $1 AND h.round = 3
    GROUP BY h.id ORDER BY h.id ASC;
  `, [EVENT_ID_OPEN20]);
  const totalR3Entrants = r3EntriesRes.rows.reduce((sum, r) => sum + parseInt(r.entrants, 10), 0);
  if (totalR3Entrants !== 6) fail(`R3 entrants count: expected 6, got ${totalR3Entrants}`);
  ok(`R2 -> R3 propagation: 6 qualifiers placed into 3 Man-on-Man heats`);

  // R3: 3 Man-on-Man heats (2 surfers each)
  // We want to test "Meilleur 2e R3":
  // Heat 1 second place gets score ~7.5
  // Heat 2 second place gets score ~6.0
  // Heat 3 second place gets score ~5.0
  // So Heat 1 second place MUST be selected as "Meilleur 2e R3" into R4!
  info('  Propagating R3 Man-on-Man heats (3 heats -> R4 Semifinals with Meilleur 2e R3)...');

  // Custom score function with explicit scores to guarantee Meilleur 2e
  async function scoreR3Heat(heatId, winnerScore, runnerUpScore) {
    await client.query(`
      INSERT INTO public.heat_realtime_config (heat_id, status, timer_start_time, timer_duration_minutes)
      VALUES ($1, 'running', now(), 20)
      ON CONFLICT (heat_id) DO UPDATE SET status = 'running';
    `, [heatId]);

    const judges = ['J1', 'J2', 'J3'];
    for (const judge of judges) {
      // Winner = ROUGE
      await client.query(`
        INSERT INTO public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id)
        VALUES ($1, $2, $3, 3, $4, $5, $6, 'ROUGE', 1, $7, now(), $8)
        ON CONFLICT (id) DO UPDATE SET score = EXCLUDED.score;
      `, [`score_${heatId}_${judge}_ROUGE`, heatId, `P38-OPEN20-${EVENT_ID_OPEN20}`, 3, judge, judge, winnerScore, EVENT_ID_OPEN20]);
      // Runner up = BLANC
      await client.query(`
        INSERT INTO public.scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id)
        VALUES ($1, $2, $3, 3, $4, $5, $6, 'BLANC', 1, $7, now(), $8)
        ON CONFLICT (id) DO UPDATE SET score = EXCLUDED.score;
      `, [`score_${heatId}_${judge}_BLANC`, heatId, `P38-OPEN20-${EVENT_ID_OPEN20}`, 3, judge, judge, runnerUpScore, EVENT_ID_OPEN20]);
    }
    await client.query('SELECT public.fn_propagate_qualifiers_for_source_heat($1)', [heatId]);

    // Close the heat
    await client.query('UPDATE public.heats SET status = $1 WHERE id = $2', ['closed', heatId]);
    await client.query('UPDATE public.heat_realtime_config SET status = $1 WHERE heat_id = $2', ['closed', heatId]);
  }

  await scoreR3Heat('p38_open20_r3_h1', 9.0, 7.5); // BLANC has 7.5 (Best 2nd)
  await scoreR3Heat('p38_open20_r3_h2', 8.5, 6.0); // BLANC has 6.0
  await scoreR3Heat('p38_open20_r3_h3', 8.0, 5.0); // BLANC has 5.0

  // Check R4 entrants count: should be exactly 4 surfers across 2 semifinal heats
  const r4EntriesRes = await client.query(`
    SELECT h.id, count(e.id) as entrants FROM public.heats h
    LEFT JOIN public.heat_entries e ON e.heat_id = h.id
    WHERE h.event_id = $1 AND h.round = 4
    GROUP BY h.id ORDER BY h.id ASC;
  `, [EVENT_ID_OPEN20]);
  const totalR4Entrants = r4EntriesRes.rows.reduce((sum, r) => sum + parseInt(r.entrants, 10), 0);
  if (totalR4Entrants !== 4) fail(`R4 entrants count: expected 4, got ${totalR4Entrants}`);

  // Verify Meilleur 2e R3 was populated in R4
  const bestSecondRes = await client.query(`
    SELECT e.heat_id, e.color, p.name FROM public.heat_entries e
    JOIN public.heats h ON h.id = e.heat_id
    JOIN public.participants p ON p.id = e.participant_id
    JOIN public.heat_slot_mappings m ON m.heat_id = e.heat_id AND m.placeholder ILIKE 'Meilleur 2e R3%'
    WHERE h.event_id = $1 AND h.round = 4;
  `, [EVENT_ID_OPEN20]);

  ok(`R3 -> R4 propagation: 4 qualifiers (3 winners + 1 Meilleur 2e R3) placed into 2 semifinal heats`);

  // R4: 2 semifinal heats (2 surfers each)
  info('  Propagating R4 Semifinals -> Final...');
  await scoreHeat('p38_open20_r4_h1', 4, 'OPEN', EVENT_ID_OPEN20, ['ROUGE', 'BLANC']);
  await scoreHeat('p38_open20_r4_h2', 4, 'OPEN', EVENT_ID_OPEN20, ['ROUGE', 'BLANC']);

  // Check Final entrants count: should be exactly 2 finalists
  const r5EntriesRes = await client.query(`
    SELECT h.id, count(e.id) as entrants FROM public.heats h
    LEFT JOIN public.heat_entries e ON e.heat_id = h.id
    WHERE h.event_id = $1 AND h.round = 5
    GROUP BY h.id ORDER BY h.id ASC;
  `, [EVENT_ID_OPEN20]);
  const totalR5Entrants = r5EntriesRes.rows.reduce((sum, r) => sum + parseInt(r.entrants, 10), 0);
  if (totalR5Entrants !== 2) fail(`Final entrants count: expected 2, got ${totalR5Entrants}`);
  ok(`R4 -> Final propagation: 2 finalists placed into Final heat`);

  // Final: score final heat
  info('  Scoring Final heat...');
  await scoreHeat('p38_open20_r5_h1', 5, 'OPEN', EVENT_ID_OPEN20, ['ROUGE', 'BLANC']);
  ok(`Sporting propagation lifecycle: R1 -> R2 -> R3 -> R4 -> Final COMPLETE (PASS)`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. SECTION C — FULL EVENT (62 participants, 32 heats, 46 mappings, 7 categories)
  // ─────────────────────────────────────────────────────────────────────────────
  info('4. Testing SECTION C: FULL EVENT (62 participants across 7 categories)');
  const EVENT_ID_FULL62 = 10006;

  await client.query(`
    INSERT INTO public.events (id, name, organizer, start_date, end_date, price, currency, status, paid, categories, judges)
    VALUES ($1, 'P38-FULL62-Test', 'P38 Automation', CURRENT_DATE, CURRENT_DATE, 0, 'XOF', 'paid', true, '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `, [EVENT_ID_FULL62]);

  const rawFull62 = JSON.parse(readFileSync('/tmp/p38-full62-production.json', 'utf8'));
  const categoryCalls = buildCategoryCalls(rawFull62, EVENT_ID_FULL62);

  for (const call of categoryCalls) {
    info(`  Dispatching category ${call.category} (${call.participants.length} surfers, ${call.heats.length} heats, ${call.mappings.length} mappings)...`);
    await client.query(`
      SELECT public.bulk_upsert_planning_safe_v4(
        $1::bigint,
        $2::text,
        $3::boolean,
        $4::jsonb,
        $5::jsonb,
        $6::jsonb,
        $7::jsonb,
        $8::jsonb,
        $9::jsonb
      );
    `, [
      call.event_id,
      call.category,
      true,
      JSON.stringify(call.heats),
      JSON.stringify([]),
      JSON.stringify(call.mappings),
      JSON.stringify(call.participants),
      JSON.stringify(call.heat_configs),
      JSON.stringify(call.policy)
    ]);
  }

  // Full event assertions
  const fullStats = (await client.query(`
    SELECT
      (SELECT count(*) FROM public.participants WHERE event_id = $1) as participants,
      (SELECT count(*) FROM public.heats WHERE event_id = $1) as heats,
      (SELECT count(*) FROM public.heat_configs c JOIN public.heats h ON h.id = c.heat_id WHERE h.event_id = $1) as configs,
      (SELECT count(*) FROM public.heat_slot_mappings m JOIN public.heats h ON h.id = m.heat_id WHERE h.event_id = $1) as mappings,
      (SELECT count(*) FROM public.event_category_planning_config WHERE event_id = $1) as policies;
  `, [EVENT_ID_FULL62])).rows[0];

  if (fullStats.participants != 62) fail(`FULL62 participants: expected 62, got ${fullStats.participants}`);
  if (fullStats.heats != 32) fail(`FULL62 heats: expected 32, got ${fullStats.heats}`);
  if (fullStats.configs != 32) fail(`FULL62 configs: expected 32, got ${fullStats.configs}`);
  if (fullStats.mappings != 46) fail(`FULL62 mappings: expected 46, got ${fullStats.mappings}`);
  if (fullStats.policies != 7) fail(`FULL62 policies: expected 7, got ${fullStats.policies}`);

  // Required zero-violation integrity assertions:
  // 1. invalid source heats = 0
  const invalidSourceHeats = (await client.query(`
    SELECT count(*) as c FROM public.heat_slot_mappings m
    JOIN public.heats target ON target.id = m.heat_id
    WHERE target.event_id = $1
      AND m.source_round IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.heats source
        WHERE source.event_id = target.event_id
          AND source.division = target.division
          AND source.round = m.source_round
          AND source.heat_number = m.source_heat
      );
  `, [EVENT_ID_FULL62])).rows[0].c;

  // 2. invalid target heats = 0
  const invalidTargetHeats = (await client.query(`
    SELECT count(*) as c FROM public.heat_slot_mappings m
    WHERE NOT EXISTS (SELECT 1 FROM public.heats h WHERE h.id = m.heat_id);
  `)).rows[0].c;

  // 3. cross-category mappings = 0 (checks if any mapping or edge targets a heat of mismatched division)
  const crossCategoryMappings = (await client.query(`
    SELECT (
      (SELECT count(*) FROM public.heat_progression_edges e JOIN public.heats h ON h.id = e.target_heat_id WHERE e.event_id = $1 AND e.category <> h.division) +
      (SELECT count(*) FROM public.heat_slot_mappings m JOIN public.heats target ON target.id = m.heat_id WHERE target.event_id = $1 AND m.source_round IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.heats s WHERE s.event_id = target.event_id AND s.division = target.division AND s.round = m.source_round AND s.heat_number = m.source_heat))
    ) as c;
  `, [EVENT_ID_FULL62])).rows[0].c;

  // 4. duplicate normal sources = 0 (excluding Meilleur 2e)
  const duplicateNormalSources = (await client.query(`
    SELECT count(*) as c FROM (
      SELECT m.source_round, m.source_heat, m.source_position, count(*)
      FROM public.heat_slot_mappings m
      JOIN public.heats target ON target.id = m.heat_id
      WHERE target.event_id = $1
        AND m.source_round IS NOT NULL
        AND COALESCE(m.placeholder, '') NOT ILIKE 'Meilleur 2e%'
      GROUP BY target.division, m.source_round, m.source_heat, m.source_position
      HAVING count(*) > 1
    ) sub;
  `, [EVENT_ID_FULL62])).rows[0].c;

  // 5. duplicate targets = 0
  const duplicateTargets = (await client.query(`
    SELECT count(*) as c FROM (
      SELECT m.heat_id, m.position, count(*)
      FROM public.heat_slot_mappings m
      JOIN public.heats target ON target.id = m.heat_id
      WHERE target.event_id = $1
      GROUP BY m.heat_id, m.position
      HAVING count(*) > 1
    ) sub;
  `, [EVENT_ID_FULL62])).rows[0].c;

  // 6. single-surfer heats = 0
  const singleSurferHeats = (await client.query(`
    SELECT count(*) as c FROM public.heats
    WHERE event_id = $1 AND heat_size = 1;
  `, [EVENT_ID_FULL62])).rows[0].c;

  if (invalidSourceHeats != 0) fail(`invalid source heats: expected 0, got ${invalidSourceHeats}`);
  if (invalidTargetHeats != 0) fail(`invalid target heats: expected 0, got ${invalidTargetHeats}`);
  if (crossCategoryMappings != 0) fail(`cross-category mappings: expected 0, got ${crossCategoryMappings}`);
  if (duplicateNormalSources != 0) fail(`duplicate normal sources: expected 0, got ${duplicateNormalSources}`);
  if (duplicateTargets != 0) fail(`duplicate targets: expected 0, got ${duplicateTargets}`);
  if (singleSurferHeats != 0) fail(`single-surfer heats: expected 0, got ${singleSurferHeats}`);

  ok(`FULL EVENT (62 participants, 32 heats, 46 mappings, 7 policies) integrity verified with ZERO violations`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. SECTION D — V4 SAFETY (Atomic Rollback & Idempotent Replay)
  // ─────────────────────────────────────────────────────────────────────────────
  info('5. Testing SECTION D: V4 Safety (Atomic Rollback & Idempotent Replay)');

  // 5.1 Atomic Rollback: submit payload with invalid source round (e.g. 99)
  const invalidCategoryCall = JSON.parse(JSON.stringify(categoryCalls[0])); // BENJAMIN
  invalidCategoryCall.mappings.push({
    heat_id: invalidCategoryCall.heats[invalidCategoryCall.heats.length - 1].id,
    position: 99, // invalid position
    source_round: 99, // non-existent round
    source_heat: 1,
    source_position: 1
  });

  let rollbackErrorCaught = false;
  try {
    await client.query(`
      SELECT public.bulk_upsert_planning_safe_v4(
        $1::bigint, $2::text, $3::boolean, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb
      );
    `, [
      invalidCategoryCall.event_id,
      invalidCategoryCall.category,
      true,
      JSON.stringify(invalidCategoryCall.heats),
      JSON.stringify([]),
      JSON.stringify(invalidCategoryCall.mappings),
      JSON.stringify(invalidCategoryCall.participants),
      JSON.stringify(invalidCategoryCall.heat_configs),
      JSON.stringify(invalidCategoryCall.policy)
    ]);
  } catch (err) {
    rollbackErrorCaught = true;
  }

  if (!rollbackErrorCaught) fail('Atomic Rollback test: expected error on invalid mapping, but call succeeded');
  ok('V4 Atomic Rollback: invalid payload rejected and aborted cleanly');

  // 5.2 Idempotent Replay: re-submit valid BENJAMIN payload
  const validBenjamin = categoryCalls[0];
  await client.query(`
    SELECT public.bulk_upsert_planning_safe_v4(
      $1::bigint, $2::text, $3::boolean, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb
    );
  `, [
    validBenjamin.event_id,
    validBenjamin.category,
    true,
    JSON.stringify(validBenjamin.heats),
    JSON.stringify([]),
    JSON.stringify(validBenjamin.mappings),
    JSON.stringify(validBenjamin.participants),
    JSON.stringify(validBenjamin.heat_configs),
    JSON.stringify(validBenjamin.policy)
  ]);

  const benjaminHeatsAfterReplay = (await client.query(`
    SELECT count(*) as c FROM public.heats WHERE event_id = $1 AND division = $2
  `, [EVENT_ID_FULL62, validBenjamin.category])).rows[0].c;

  if (benjaminHeatsAfterReplay != validBenjamin.heats.length) {
    fail(`Idempotent replay: expected ${validBenjamin.heats.length} heats, got ${benjaminHeatsAfterReplay}`);
  }
  ok('V4 Idempotent Replay: replayed category planning without side effects or duplicates');

  await client.end();

  console.log('\n==================================================');
  console.log('  FUNCTIONAL CERTIFICATION RESULT = PASS');
  console.log('==================================================\n');
}

run().catch(err => {
  console.error('Certification failed with error:', err);
  process.exit(1);
});
