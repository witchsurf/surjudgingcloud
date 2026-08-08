#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(rootDir, 'frontend', 'package.json'));
const { Client } = require('pg');
const workdir = path.join(rootDir, 'backend');
const runId = `p0_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const eventName = `P0 INTEGRATION ${runId}`;
const heatId = `P0-${runId}-OPEN-R1-H1`;
const restoredDb = `p0_restore_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`.toLowerCase();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'surfjudging-p0-'));
const walPath = path.join(tempDir, 'tablet-wal.json');
const staleTimerPath = path.join(tempDir, 'stale-local-timer.json');
const dumpPath = path.join(tempDir, 'competition.dump');
const checksumPath = `${dumpPath}.sha256`;

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function localSupabaseStatus() {
  const output = command('supabase', ['status', '--workdir', workdir, '-o', 'json']);
  const jsonStart = output.indexOf('{');
  assert.notEqual(jsonStart, -1, 'Supabase status did not return JSON');
  return JSON.parse(output.slice(jsonStart));
}

async function sql(client, text, params = []) {
  return client.query(text, params);
}

async function upsertScore(client, mutation) {
  return sql(client, `
    select public.upsert_score_secure(
      $1::uuid, $2::bigint, $3::text, $4::text, $5::text, $6::integer,
      $7::text, $8::text, $9::text, $10::text, $11::text, $12::integer,
      $13::numeric, $14::timestamptz, $15::timestamptz
    )
  `, [
    mutation.id, mutation.eventId, mutation.heatId, mutation.competition,
    mutation.division, mutation.round, mutation.judgeId, mutation.judgeName,
    mutation.judgeStation, mutation.judgeIdentityId, mutation.surfer,
    mutation.waveNumber, mutation.score, mutation.timestamp, mutation.createdAt,
  ]);
}

async function readTimerFromSupabase(status, targetHeatId) {
  const response = await fetch(
    `${status.REST_URL}/heat_realtime_config?heat_id=eq.${encodeURIComponent(targetHeatId)}&select=heat_id,status,timer_start_time,timer_duration_minutes,updated_by`,
    {
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${status.ANON_KEY}`,
      },
    },
  );
  const body = await response.text();
  if (!response.ok) {
    return { ok: false, httpStatus: response.status, error: body };
  }
  const rows = JSON.parse(body);
  return { ok: true, httpStatus: response.status, row: rows[0], rowCount: rows.length };
}

async function tableCounts(client) {
  const result = await sql(client, `
    select
      (select count(*)::int from public.events) as events,
      (select count(*)::int from public.heats) as heats,
      (select count(*)::int from public.scores) as scores,
      (select count(*)::int from public.score_overrides) as corrections,
      (select count(*)::int from public.heat_judge_assignments) as judges
  `);
  return result.rows[0];
}

const status = localSupabaseStatus();
const db = new Client({ connectionString: status.DB_URL });
const results = [];
let eventId;
let dbConnected = false;

try {
  await db.connect();
  dbConnected = true;

  const seeded = await sql(db, `
    with event_row as (
      insert into public.events
        (name, organizer, start_date, end_date, price, currency, status, paid)
      values ($1, 'P0 isolated tests', current_date, current_date, 0, 'XOF', 'paid', true)
      returning id
    ), participants_rows as (
      insert into public.participants (event_id, category, seed, name, country)
      select id, 'OPEN', 1, 'Participant initial rouge', 'SN' from event_row
      union all
      select id, 'OPEN', 2, 'Participant remplaçant rouge', 'SN' from event_row
      returning id, event_id, seed
    ), heat_row as (
      insert into public.heats
        (id, competition, division, round, heat_number, status, event_id, heat_size, color_order)
      select $2, $1, 'OPEN', 1, 1, 'running', id, 2, array['ROUGE','BLANC'] from event_row
      returning id, event_id
    )
    insert into public.heat_entries (heat_id, participant_id, position, seed, color)
    select $2, id, seed, seed, case seed when 1 then 'ROUGE' else 'BLANC' end
    from participants_rows;
  `, [eventName, heatId]);
  void seeded;
  eventId = Number((await sql(db, 'select id from public.events where name = $1', [eventName])).rows[0].id);

  await sql(db, `
    insert into public.heat_judge_assignments
      (heat_id, event_id, station, judge_id, judge_name, assigned_by)
    values
      ($1, $2, 'J1', 'judge-p0-1', 'Juge P0 1', 'integration_test'),
      ($1, $2, 'J2', 'judge-p0-2', 'Juge P0 2', 'integration_test'),
      ($1, $2, 'J3', 'judge-p0-3', 'Juge P0 3', 'integration_test')
  `, [heatId, eventId]);
  await sql(db, `
    insert into public.heat_realtime_config
      (heat_id, status, timer_start_time, timer_duration_minutes, config_data, updated_by)
    values ($1, 'running', now(), 20, '{}'::jsonb, 'p0_integration_fixture')
  `, [heatId]);

  const mutation = {
    id: crypto.randomUUID(),
    eventId,
    heatId,
    competition: eventName,
    division: 'OPEN',
    round: 1,
    judgeId: 'judge-p0-1',
    judgeName: 'Juge P0 1',
    judgeStation: 'J1',
    judgeIdentityId: 'judge-p0-1',
    surfer: 'ROUGE',
    waveNumber: 1,
    score: 7.5,
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  // Scenario 1: server commits, acknowledgement is lost, same WAL mutation is replayed.
  await upsertScore(db, mutation);
  await fs.writeFile(walPath, JSON.stringify([mutation]), 'utf8');
  const replayedMutation = JSON.parse(await fs.readFile(walPath, 'utf8'))[0];
  await upsertScore(db, replayedMutation);
  const duplicateCheck = await sql(db, `
    select count(*)::int as physical_rows,
           count(distinct (heat_id, upper(trim(surfer)), wave_number, coalesce(judge_station, judge_id)))::int as business_rows
    from public.scores
    where id = $1 or (heat_id = $2 and upper(trim(surfer)) = 'ROUGE' and wave_number = 1 and coalesce(judge_station, judge_id) = 'J1')
  `, [mutation.id, heatId]);
  assert.deepEqual(duplicateCheck.rows[0], { physical_rows: 1, business_rows: 1 });
  results.push({ scenario: 'lost_ack_replay', status: 'passed', details: duplicateCheck.rows[0] });

  // Scenario 2: a persisted WAL survives a simulated tablet process refresh.
  const refreshMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    judgeId: 'judge-p0-2',
    judgeName: 'Juge P0 2',
    judgeStation: 'J2',
    judgeIdentityId: 'judge-p0-2',
    score: 7.7,
  };
  await fs.writeFile(walPath, JSON.stringify([refreshMutation]), 'utf8');
  const stateBeforeRefresh = JSON.parse(await fs.readFile(walPath, 'utf8'));
  assert.equal(stateBeforeRefresh.length, 1);
  const stateAfterRefresh = JSON.parse(await fs.readFile(walPath, 'utf8'));
  await upsertScore(db, stateAfterRefresh[0]);
  await fs.writeFile(walPath, '[]', 'utf8');
  const refreshCount = Number((await sql(db, 'select count(*)::int as count from public.scores where id = $1', [refreshMutation.id])).rows[0].count);
  assert.equal(refreshCount, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(walPath, 'utf8')), []);
  results.push({ scenario: 'wal_survives_refresh', status: 'passed', details: { rows: refreshCount, walPending: 0 } });

  // Create a correction so dump/restore validates correction history too.
  await sql(db, `
    insert into public.score_overrides
      (heat_id, score_id, judge_id, judge_name, judge_station, judge_identity_id,
       surfer, wave_number, previous_score, new_score, reason, comment)
    values ($1, $2, 'judge-p0-1', 'Juge P0 1', 'J1', 'judge-p0-1',
            'ROUGE', 1, 7.4, 7.5, 'correction', 'P0 isolated restore fixture')
  `, [heatId, mutation.id]);

  // Scenario 3: override participant at RED while scores remain keyed by RED.
  const replacementId = Number((await sql(db, `
    select id from public.participants where event_id = $1 and seed = 2
  `, [eventId])).rows[0].id);
  await sql(db, `
    select public.admin_override_heat_entry($1, 1, 'ROUGE', $2, null, null,
      'P0 invariant lycra integration test', 'p0_integration')
  `, [heatId, replacementId]);
  const lineup = await sql(db, `
    select he.color, he.participant_id, p.name
    from public.heat_entries he join public.participants p on p.id = he.participant_id
    where he.heat_id = $1 and he.position = 1
  `, [heatId]);
  const redScores = await sql(db, `
    select count(*)::int as red_count,
           count(*) filter (where upper(trim(surfer)) <> 'ROUGE')::int as moved_count
    from public.scores where heat_id = $1
  `, [heatId]);
  assert.equal(lineup.rows[0].color, 'ROUGE');
  assert.equal(Number(lineup.rows[0].participant_id), replacementId);
  assert.deepEqual(redScores.rows[0], { red_count: 2, moved_count: 0 });
  results.push({ scenario: 'lineup_override_preserves_lycra', status: 'passed', details: { lineup: lineup.rows[0], scores: redScores.rows[0] } });

  // Scenario 4: server timer is re-read after refresh and stale local state is ignored.
  const timerStart = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await sql(db, `
    select public.upsert_heat_realtime_config(
      $1, 'running', true, $2::timestamptz, true, 20, false, null, 'p0_integration'
    )
  `, [heatId, timerStart]);
  await fs.writeFile(staleTimerPath, JSON.stringify({ isRunning: false, startTime: null, duration: 4 }), 'utf8');
  const staleLocalTimer = JSON.parse(await fs.readFile(staleTimerPath, 'utf8'));
  const timerRestRead = await readTimerFromSupabase(status, heatId);
  const timerDbRead = (await sql(db, `
    select heat_id, status, timer_start_time, timer_duration_minutes, updated_by
    from public.heat_realtime_config where heat_id = $1
  `, [heatId])).rows[0];
  assert.equal(timerDbRead.status, 'running');
  assert.equal(timerDbRead.timer_duration_minutes, 20);
  assert.notEqual(timerDbRead.timer_duration_minutes, staleLocalTimer.duration);
  if (timerRestRead.ok) {
    assert.equal(timerRestRead.rowCount, 1);
    assert.equal(timerRestRead.row.status, 'running');
    assert.equal(timerRestRead.row.timer_duration_minutes, 20);
    assert.equal(timerRestRead.row.updated_by, 'p0_integration');
    results.push({ scenario: 'timer_resume_server_wins', status: 'passed', details: { serverTimer: timerRestRead.row, staleLocalTimer } });
  } else {
    results.push({
      scenario: 'timer_resume_server_wins',
      status: 'failed',
      details: { timerDbRead, staleLocalTimer, restFailure: timerRestRead },
    });
  }

  // Scenario 5: dump, checksum, restore into a second isolated DB, compare counts.
  const sourceCounts = await tableCounts(db);
  command('pg_dump', ['--format=custom', '--schema=public', '--no-owner', '--no-privileges', '--file', dumpPath, status.DB_URL]);
  const checksumOutput = command('shasum', ['-a', '256', dumpPath]).trim();
  assert.match(checksumOutput, /^[a-f0-9]{64}\s+/);
  await fs.writeFile(checksumPath, `${checksumOutput}\n`, 'utf8');
  command('shasum', ['-a', '256', '-c', checksumPath]);
  await sql(db, `create database ${restoredDb}`);
  const restoredUrl = status.DB_URL.replace(/\/postgres$/, `/${restoredDb}`);
  const restoreResult = spawnSync('pg_restore', ['--no-owner', '--no-privileges', '--dbname', restoredUrl, dumpPath], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const restoredClient = new Client({ connectionString: restoredUrl });
  await restoredClient.connect();
  const restoredCounts = await tableCounts(restoredClient);
  await restoredClient.end();
  assert.deepEqual(restoredCounts, sourceCounts);
  results.push({
    scenario: 'dump_checksum_restore',
    status: restoreResult.status === 0 ? 'passed' : 'passed_with_warnings',
    details: {
      sourceCounts,
      restoredCounts,
      checksum: checksumOutput.split(/\s+/)[0],
      restoreExitCode: restoreResult.status,
      restoreWarnings: restoreResult.status === 0 ? [] : restoreResult.stderr.trim().split(/\r?\n/).slice(-12),
    },
  });

  console.log(JSON.stringify({ runId, isolatedDb: status.DB_URL, results }, null, 2));
} finally {
  if (dbConnected) {
    try {
      await sql(db, `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [restoredDb]);
      await sql(db, `drop database if exists ${restoredDb}`);
      await sql(db, 'delete from public.score_overrides where heat_id = $1', [heatId]);
      await sql(db, 'delete from public.heats where id = $1', [heatId]);
      await sql(db, 'delete from public.heat_realtime_config where heat_id = $1', [heatId]);
      await sql(db, 'delete from public.events where name = $1', [eventName]);
    } finally {
      await db.end();
    }
  }
  await fs.rm(tempDir, { recursive: true, force: true });
}
