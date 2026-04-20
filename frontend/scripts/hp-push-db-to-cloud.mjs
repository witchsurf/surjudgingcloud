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

const CLOUD_URL = process.env.VITE_SUPABASE_URL_CLOUD;
const CLOUD_KEY = process.env.VITE_SUPABASE_ANON_KEY_CLOUD;
const LOCAL_URL = process.env.VITE_SUPABASE_URL_LAN;
const LOCAL_KEY = process.env.VITE_SUPABASE_ANON_KEY_LAN;

if (!CLOUD_URL || !CLOUD_KEY || !LOCAL_URL || !LOCAL_KEY) {
  console.error('❌ Error: Supabase credentials missing in environment.');
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

async function fetchPagedRows(client, tableName, queryBuilder, pageSize = 1000) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilder(client.from(tableName)).range(from, to);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
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
    const eventIds = (events || []).map((event) => event.id);

    if (!eventIds.length) {
      console.log('ℹ️ No local events found. Nothing to sync.');
      process.exit(0);
    }

    console.log(`   Found ${eventIds.length} events to inspect: ${eventIds.join(', ')}`);

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

    console.log('🚀 Pushing local field data to Cloud...');
    const participantCount = await upsertRows(cloud, 'participants', participants, 'id');
    const heatEntryCount = await upsertRows(cloud, 'heat_entries', heatEntries, 'heat_id,position');
    const scoreCount = await upsertRows(cloud, 'scores', scores, 'id');
    const interferenceCount = await upsertRows(
      cloud,
      'interference_calls',
      interferenceCalls,
      'heat_id,judge_id,surfer,wave_number'
    );
    const realtimeCount = await upsertRows(cloud, 'heat_realtime_config', realtimeConfigs, 'heat_id');
    const lineupOverrideCount = await upsertRows(cloud, 'heat_entry_overrides', heatEntryOverrides, 'id');
    const pointerCount = await syncActiveHeatPointers(activeHeatPointers);

    const heatsById = new Map((heats || []).map((heat) => [heat.id, heat]));
    const closedHeatIds = Array.from(
      new Set(
        (realtimeConfigs || [])
          .filter((row) => String(row.status || '').trim().toLowerCase() === 'closed')
          .map((row) => row.heat_id)
      )
    );

    let propagatedSlots = 0;
    if (closedHeatIds.length) {
      console.log('🧠 Replaying qualifier propagation on Cloud...');
      for (const heatId of closedHeatIds) {
        try {
          const updated = Number(
            await callRpc(cloud, 'fn_propagate_qualifiers_for_source_heat', {
              p_source_heat_id: heatId,
            }) ?? 0
          );
          propagatedSlots += updated;
          console.log(`  - ${heatId}: ${updated} slot(s) updated`);
        } catch (error) {
          console.log(`  - ${heatId}: ❌ Failed`);
          console.error(`    Propagation error for ${heatId}:`, error.message);
          globalError = true;
        }
      }
    } else {
      console.log('🧠 No locally closed heats found for propagation replay.');
    }

    const affectedDivisions = Array.from(
      new Set(
        [...scores, ...interferenceCalls, ...heatEntryOverrides]
          .map((row) => {
            const heat = heatsById.get(row.heat_id);
            if (!heat) return null;
            return `${heat.event_id}::${String(heat.division || '').trim()}`;
          })
          .filter(Boolean)
      )
    );

    let rebuiltSlots = 0;
    if (affectedDivisions.length) {
      console.log('♻️ Rebuilding affected divisions on Cloud...');
      for (const key of affectedDivisions) {
        const [eventIdRaw, division] = key.split('::');
        const eventId = Number(eventIdRaw);
        if (!eventId || !division) continue;
        try {
          const updated = Number(
            await callRpc(cloud, 'rebuild_division_qualifiers_from_scores', {
              p_event_id: eventId,
              p_division: division,
            }) ?? 0
          );
          rebuiltSlots += updated;
          console.log(`  - event ${eventId} / ${division}: ${updated} slot(s) rebuilt`);
        } catch (error) {
          console.log(`  - event ${eventId} / ${division}: ❌ Failed`);
          console.error(`    Rebuild error for event ${eventId} / ${division}:`, error.message);
          globalError = true;
        }
      }
    } else {
      console.log('♻️ No affected divisions detected from local field data.');
    }

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
