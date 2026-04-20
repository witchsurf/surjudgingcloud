#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match) return;
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    });
  } catch (error) {
    console.error('⚠️ Impossible de charger .env.local automatiquement:', error.message);
  }
}

loadEnv();

function parseArgs(argv) {
  const options = {
    eventIds: [],
    allEvents: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--event-id' || arg === '--event') {
      const value = argv[index + 1];
      index += 1;
      if (!value) throw new Error(`${arg} requires a value`);
      options.eventIds.push(...value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite));
    } else if (arg.startsWith('--event-id=')) {
      const value = arg.slice('--event-id='.length);
      options.eventIds.push(...value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite));
    } else if (arg === '--all-events') {
      options.allEvents = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`Usage: node scripts/hp-push-db-to-cloud.mjs --event-id 17 [--dry-run]\n       node scripts/hp-push-db-to-cloud.mjs --all-events [--dry-run]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const envEventId = process.env.SURF_SYNC_EVENT_ID || process.env.SURF_EVENT_ID;
  if (!options.eventIds.length && envEventId) {
    options.eventIds.push(...envEventId.split(',').map((item) => Number(item.trim())).filter(Number.isFinite));
  }

  options.eventIds = Array.from(new Set(options.eventIds));
  return options;
}

const options = parseArgs(process.argv.slice(2));
const CLOUD_URL = process.env.VITE_SUPABASE_URL_CLOUD;
const CLOUD_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY_CLOUD ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY_CLOUD ||
  process.env.VITE_SUPABASE_ANON_KEY_CLOUD;
const LOCAL_URL = process.env.VITE_SUPABASE_URL_LAN;
const LOCAL_KEY = process.env.VITE_SUPABASE_ANON_KEY_LAN;
const usingCloudServiceRole = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY_CLOUD ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY_CLOUD
);

if (!CLOUD_URL || !CLOUD_KEY || !LOCAL_URL || !LOCAL_KEY) {
  console.error('❌ Error: Supabase credentials missing in environment.');
  process.exit(1);
}

if (!options.allEvents && options.eventIds.length === 0) {
  console.error('❌ Refusing broad field sync without an event scope.');
  console.error('   Use: node scripts/hp-push-db-to-cloud.mjs --event-id 17');
  console.error('   Or explicit full sync: node scripts/hp-push-db-to-cloud.mjs --all-events');
  process.exit(1);
}

if (!options.dryRun && !usingCloudServiceRole) {
  console.error('❌ Cloud service-role key is required for Field Box -> Cloud sync.');
  console.error('   This sync writes field facts across event ownership/RLS boundaries.');
  console.error('   Set SUPABASE_SERVICE_ROLE_KEY_CLOUD in frontend/.env.local or shell.');
  process.exit(1);
}

const cloud = createClient(CLOUD_URL, CLOUD_KEY);
const local = createClient(LOCAL_URL, LOCAL_KEY);

let globalError = false;

function chunkArray(items, size) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchPagedRows(client, tableName, queryBuilder, pageSize = 500) {
  const rows = [];
  let from = 0;
  const MAX_RETRIES = 3;

  while (true) {
    const to = from + pageSize - 1;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data, error } = await queryBuilder(client.from(tableName)).range(from, to);
        if (error) throw error;
        const batch = data || [];
        rows.push(...batch);
        if (batch.length < pageSize) return rows;
        from += pageSize;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delay = attempt * 1000;
          process.stdout.write(`\n    ⚠️ ${tableName} fetch retry ${attempt}/${MAX_RETRIES} (waiting ${delay}ms)... `);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (lastError) throw lastError;
  }
}

async function checkReachability(label, url) {
  process.stdout.write(`🔍 Checking ${label} reachability (${url})... `);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { signal: controller.signal, mode: 'no-cors' });
    clearTimeout(timeoutId);
    console.log('✅ OK');
    return true;
  } catch (error) {
    console.log('❌ Unreachable');
    return false;
  }
}

async function upsertRows(client, tableName, rows, onConflict = 'id', batchSize = 500) {
  if (!rows.length) {
    console.log(`  - No rows to sync for ${tableName}`);
    return 0;
  }

  process.stdout.write(`  - Upserting ${rows.length} rows to ${tableName}... `);
  let synced = 0;

  for (const batch of chunkArray(rows, batchSize)) {
    const { error } = await client.from(tableName).upsert(batch, { onConflict });
    if (error) {
      console.log('❌ Failed');
      console.error(`    Error in ${tableName}:`, error.message);
      globalError = true;
      return synced;
    }
    synced += batch.length;
  }

  console.log('✅ Done');
  return synced;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value ?? null;
}

function comparableRow(row) {
  const ignored = new Set(['created_at', 'updated_at']);
  return Object.keys(row || {})
    .filter((key) => !ignored.has(key))
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableValue(row[key]);
      return acc;
    }, {});
}

function rowSignature(row) {
  return JSON.stringify(comparableRow(row));
}

function rowSignatureForKeys(row, keys) {
  return JSON.stringify(keys.sort().reduce((acc, key) => {
    acc[key] = stableValue(row?.[key]);
    return acc;
  }, {}));
}

async function filterChangedRows(client, tableName, rows, keyFields) {
  if (!rows.length) return [];
  const existingByKey = new Map();

  if (keyFields.length === 1) {
    const keyField = keyFields[0];
    const keys = Array.from(new Set(rows.map((row) => row[keyField]).filter((value) => value !== null && value !== undefined)));
    for (const batch of chunkArray(keys, 500)) {
      const existing = await fetchPagedRows(client, tableName, (query) => query.select('*').in(keyField, batch));
      existing.forEach((row) => existingByKey.set(String(row[keyField]), row));
    }
  } else {
    // Composite keys are usually scoped by heat_id/event_id in this script; fetch using the broadest available field.
    const scopeField = keyFields.includes('heat_id') ? 'heat_id' : keyFields[0];
    const scopeValues = Array.from(new Set(rows.map((row) => row[scopeField]).filter((value) => value !== null && value !== undefined)));
    for (const batch of chunkArray(scopeValues, 500)) {
      const existing = await fetchPagedRows(client, tableName, (query) => query.select('*').in(scopeField, batch));
      existing.forEach((row) => existingByKey.set(keyFields.map((field) => String(row[field] ?? '')).join('::'), row));
    }
  }

  return rows.filter((row) => {
    const key = keyFields.map((field) => String(row[field] ?? '')).join('::');
    const existing = existingByKey.get(key);
    const compareKeys = Object.keys(row || {});
    return !existing || rowSignatureForKeys(existing, compareKeys) !== rowSignatureForKeys(row, compareKeys);
  });
}

async function syncActiveHeatPointers(rows) {
  if (!rows.length) {
    console.log('  - No rows to sync for active_heat_pointer');
    return 0;
  }

  process.stdout.write(`  - Upserting ${rows.length} rows to active_heat_pointer... `);

  try {
    for (const batch of chunkArray(rows, 200)) {
      const { error } = await cloud.from('active_heat_pointer').upsert(batch, { onConflict: 'event_id' });
      if (error) throw error;
    }
    console.log('✅ Done');
    return rows.length;
  } catch (error) {
    console.log('⚠️ Fallback');
    console.error('    event_id upsert fallback:', error.message);
  }

  let synced = 0;
  for (const row of rows) {
    try {
      const { error } = await cloud.from('active_heat_pointer').upsert(row, { onConflict: 'event_name' });
      if (error) throw error;
      synced += 1;
    } catch (error) {
      console.error(`    Error in active_heat_pointer for event ${row.event_id}:`, error.message);
      globalError = true;
    }
  }

  return synced;
}

async function callRpc(client, fnName, args) {
  const { data, error } = await client.rpc(fnName, args);
  if (error) throw error;
  return data;
}

async function main() {
  console.log('======================================================');
  console.log('📤 HP Database Sync (Local -> Cloud)');
  console.log(`🏠 Local: ${LOCAL_URL}`);
  console.log(`☁️ Cloud: ${CLOUD_URL}`);
  console.log(`🎯 Scope: ${options.allEvents ? 'ALL EVENTS (explicit)' : `event ${options.eventIds.join(', ')}`}`);
  console.log(`🔐 Cloud role: ${usingCloudServiceRole ? 'service_role' : 'anon read-only'}`);
  if (options.dryRun) console.log('🧪 Dry-run: no writes will be performed');
  console.log('======================================================');

  const localOk = await checkReachability('local server', LOCAL_URL);
  const cloudOk = await checkReachability('cloud server', CLOUD_URL);
  if (!localOk || !cloudOk) {
    process.exit(1);
  }

  try {
    console.log('🔍 Identifying local events to sync...');
    const { data: events, error: eventsError } = await local.from('events').select('id, name');
    if (eventsError) throw eventsError;
    const availableEventIds = (events || []).map((event) => event.id);
    const eventIds = options.allEvents
      ? availableEventIds
      : options.eventIds.filter((eventId) => availableEventIds.includes(eventId));

    if (!eventIds.length) {
      console.log('ℹ️ No matching local events found. Nothing to sync.');
      process.exit(0);
    }

    const skippedEventIds = options.eventIds.filter((eventId) => !availableEventIds.includes(eventId));
    if (skippedEventIds.length) {
      console.log(`   ⚠️ Requested event(s) not present locally: ${skippedEventIds.join(', ')}`);
    }
    console.log(`   Sync scope: ${eventIds.join(', ')}`);

    const { data: heats, error: heatsError } = await local
      .from('heats')
      .select('id, event_id, competition, division, round, heat_number, status')
      .in('event_id', eventIds);
    if (heatsError) throw heatsError;

    const heatIds = (heats || []).map((heat) => heat.id);
    if (!heatIds.length) {
      console.log('ℹ️ No local heats found. Nothing to sync.');
      process.exit(0);
    }

    console.log('☁️ Preparing local data payloads...');
    const participants = await fetchPagedRows(local, 'participants', (query) =>
      query
        .select('id, event_id, category, seed, name, country, license, created_at')
        .in('event_id', eventIds)
    );
    const heatEntries = await fetchPagedRows(local, 'heat_entries', (query) =>
      query
        .select('heat_id, participant_id, position, seed, color, created_at')
        .in('heat_id', heatIds)
    );
    const scores = await fetchPagedRows(local, 'scores', (query) =>
      query
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, judge_identity_id, surfer, wave_number, score, timestamp, created_at')
        .in('heat_id', heatIds)
        .order('created_at', { ascending: true })
    );
    const interferenceCalls = await fetchPagedRows(local, 'interference_calls', (query) =>
      query
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, judge_identity_id, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
        .in('heat_id', heatIds)
    );
    const realtimeConfigs = await fetchPagedRows(local, 'heat_realtime_config', (query) =>
      query
        .select('heat_id, status, timer_start_time, timer_duration_minutes, config_data, updated_at, updated_by')
        .in('heat_id', heatIds)
    );
    const activeHeatPointers = await fetchPagedRows(local, 'active_heat_pointer', (query) =>
      query
        .select('event_id, event_name, active_heat_id, updated_at')
        .in('event_id', eventIds)
    );
    const heatEntryOverrides = await fetchPagedRows(local, 'heat_entry_overrides', (query) =>
      query
        .select('id, event_id, heat_id, position, color, previous_participant_id, previous_participant_name, new_participant_id, new_participant_name, new_country, reason, created_by, created_at')
        .in('heat_id', heatIds)
    ).catch((error) => {
      console.warn('⚠️ heat_entry_overrides not available yet, skipping:', error.message);
      return [];
    });

    console.log('🧮 Calculating Cloud diff...');
    async function safeDiff(tableName, rows, keys) {
      process.stdout.write(`  - Diffing ${tableName} (${rows.length} local rows)... `);
      try {
        const changed = await filterChangedRows(cloud, tableName, rows, keys);
        console.log(`${changed.length} changed`);
        return changed;
      } catch (err) {
        console.log(`❌ Failed: ${err.message}`);
        console.warn(`    ⚠️ Falling back to full sync for ${tableName}`);
        return rows;
      }
    }
    const changedParticipants = await safeDiff('participants', participants, ['id']);
    const changedHeatEntries = await safeDiff('heat_entries', heatEntries, ['heat_id', 'position']);
    const changedScores = await safeDiff('scores', scores, ['id']);
    const changedInterferenceCalls = await safeDiff('interference_calls', interferenceCalls, ['heat_id', 'judge_id', 'surfer', 'wave_number']);
    const changedRealtimeConfigs = await safeDiff('heat_realtime_config', realtimeConfigs, ['heat_id']);
    const changedHeatEntryOverrides = await safeDiff('heat_entry_overrides', heatEntryOverrides, ['id'])
      .catch(() => []);
    const changedActiveHeatPointers = await safeDiff('active_heat_pointer', activeHeatPointers, ['event_id'])
      .catch(async () => safeDiff('active_heat_pointer', activeHeatPointers, ['event_name']));


    console.log(`  - participants: ${changedParticipants.length}/${participants.length} changed`);
    console.log(`  - heat_entries: ${changedHeatEntries.length}/${heatEntries.length} changed`);
    console.log(`  - scores: ${changedScores.length}/${scores.length} changed`);
    console.log(`  - interference_calls: ${changedInterferenceCalls.length}/${interferenceCalls.length} changed`);
    console.log(`  - heat_realtime_config: ${changedRealtimeConfigs.length}/${realtimeConfigs.length} changed`);
    console.log(`  - heat_entry_overrides: ${changedHeatEntryOverrides.length}/${heatEntryOverrides.length} changed`);
    console.log(`  - active_heat_pointer: ${changedActiveHeatPointers.length}/${activeHeatPointers.length} changed`);

    let participantCount = 0;
    let heatEntryCount = 0;
    let scoreCount = 0;
    let interferenceCount = 0;
    let realtimeCount = 0;
    let lineupOverrideCount = 0;
    let pointerCount = 0;

    console.log('🚀 Pushing local field diff to Cloud...');
    if (!options.dryRun) {
      participantCount = await upsertRows(cloud, 'participants', changedParticipants, 'id');
      heatEntryCount = await upsertRows(cloud, 'heat_entries', changedHeatEntries, 'heat_id,position');

      // Temporarily force ALL heats with scores to 'running' on Cloud 
      // so the fn_block_scoring_when_not_running trigger allows the upsert.
      const scoreHeatIds = Array.from(new Set(changedScores.map((score) => score.heat_id)));
      if (scoreHeatIds.length) {
        console.log(`  ℹ️ Temporarily setting ${scoreHeatIds.length} heat(s) to 'running' for score sync...`);
        const tempRunningConfigs = scoreHeatIds.map((heatId) => ({
          heat_id: heatId,
          status: 'running',
        }));
        await upsertRows(cloud, 'heat_realtime_config', tempRunningConfigs, 'heat_id');
      }

      scoreCount = await upsertRows(cloud, 'scores', changedScores, 'id');
      interferenceCount = await upsertRows(
        cloud,
        'interference_calls',
        changedInterferenceCalls,
        'heat_id,judge_id,surfer,wave_number'
      );

      // Now restore the REAL statuses from the field box
      const finalRealtimeByHeat = new Map();
      changedRealtimeConfigs.forEach((row) => finalRealtimeByHeat.set(row.heat_id, row));
      // Also include any heats we temporarily opened but that aren't in the changed set
      realtimeConfigs
        .filter((row) => scoreHeatIds.includes(row.heat_id))
        .forEach((row) => finalRealtimeByHeat.set(row.heat_id, row));
      console.log(`  ℹ️ Restoring real statuses for ${finalRealtimeByHeat.size} heat(s)...`);
      realtimeCount = await upsertRows(cloud, 'heat_realtime_config', Array.from(finalRealtimeByHeat.values()), 'heat_id');
      lineupOverrideCount = await upsertRows(cloud, 'heat_entry_overrides', changedHeatEntryOverrides, 'id');
      pointerCount = await syncActiveHeatPointers(changedActiveHeatPointers);
    } else {
      console.log('  - Dry-run enabled: writes skipped');
    }

    const heatsById = new Map((heats || []).map((heat) => [heat.id, heat]));
    const closedHeatIds = Array.from(
      new Set(
        (realtimeConfigs || [])
          .filter((row) => String(row.status || '').trim().toLowerCase() === 'closed')
          .map((row) => row.heat_id)
      )
    );

    let propagatedSlots = 0;
    // IMPORTANT: Do NOT re-run qualifier propagation after field sync.
    // The field data (heat_entries) is the source of truth — the bracket 
    // assignments were decided by the head judge on the beach.
    // Re-running propagation would overwrite correct field entries with
    // algo-computed ones that may use different slot mapping patterns.
    console.log('🧠 Qualifier propagation: SKIPPED (field data is source of truth)');

    const affectedDivisions = Array.from(
      new Set(
        [...changedScores, ...changedInterferenceCalls, ...changedHeatEntryOverrides]
          .map((row) => {
            const heat = heatsById.get(row.heat_id);
            if (!heat) return null;
            return `${heat.event_id}::${String(heat.division || '').trim()}`;
          })
          .filter(Boolean)
      )
    );

    let rebuiltSlots = 0;
    // IMPORTANT: Do NOT rebuild divisions after field sync — same reason as above.
    console.log('♻️ Division rebuild: SKIPPED (field data is source of truth)');

    console.log('======================================================');
    if (globalError) {
      console.log('⚠️ SYNC COMPLETED WITH WARNINGS');
    } else {
      console.log('✅ SYNC COMPLETED SUCCESSFULLY');
    }
    console.log('======================================================');
    console.log(`Participants synced: ${participantCount}`);
    console.log(`Heat entries synced: ${heatEntryCount}`);
    console.log(`Scores synced: ${scoreCount}`);
    console.log(`Interference calls synced: ${interferenceCount}`);
    console.log(`Realtime rows synced: ${realtimeCount}`);
    console.log(`Lineup overrides synced: ${lineupOverrideCount}`);
    console.log(`Active heat pointers synced: ${pointerCount}`);
    console.log(`Closed heats replayed: ${closedHeatIds.length}`);
    console.log(`Propagation slots updated: ${propagatedSlots}`);
    console.log(`Division rebuild slots updated: ${rebuiltSlots}`);

    if (globalError) {
      process.exit(2);
    }
  } catch (error) {
    console.error('❌ Fatal sync error:', error.message);
    process.exit(1);
  }
}

main();
